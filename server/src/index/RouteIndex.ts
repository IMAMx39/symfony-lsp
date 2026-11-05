import * as fs from 'node:fs';
import * as path from 'node:path';
import { Location, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Parsers } from '../parsing/parsers';
import { fileNamespace } from '../parsing/phpNames';
import { ComposerAutoload } from '../project/ComposerAutoload';
import { extractAttributeRoutes } from '../routing/attributeRoutes';
import { parseCompiledGeneratorRoutes, parseCompiledMatcherMethods } from '../routing/compiledRoutes';
import type { RouteExtraction, RouteImport, RouteInfo } from '../routing/types';
import { parseRouteYaml } from '../routing/yamlRoutes';
import { isInsidePath, pathKey, pathToUri } from '../util/paths';

/** Environment whose routes are mirrored (the one developers run). */
export const ROUTING_ENV = 'dev';

const IGNORED_DIRS = new Set(['vendor', 'var', 'node_modules', 'public', '.git']);

/** What a changed file means for the routes of a project. */
export type RouteFileKind = 'routing-config' | 'compiled' | 'autoload' | 'source' | null;

export function routeFileKind(file: string, projectRoot: string): RouteFileKind {
  const relative = path.relative(projectRoot, file).split(path.sep).join('/');
  if (/^config\/routes(\.ya?ml|\.php|\/.+\.(ya?ml|php))$/.test(relative)) {
    return 'routing-config';
  }
  if (new RegExp(`^var/cache/${ROUTING_ENV}/url_(generating|matching)_routes\\.php$`).test(relative)) {
    return 'compiled';
  }
  if (relative === 'composer.json' || relative === 'vendor/composer/installed.json') {
    return 'autoload';
  }
  return /^src\/.+\.php$/.test(relative) ? 'source' : null;
}

/**
 * All routes of a project, merged from (lowest to highest priority):
 * 1. the compiled cache var/cache/dev/url_{generating,matching}_routes.php (every route,
 *    bundles included, but possibly stale);
 * 2. YAML routes of config/routes.yaml and config/routes/{,dev/}*.yaml;
 * 3. #[Route] attributes of src/ (with the prefixes of the YAML imports covering them).
 * Open documents can override the content of their PHP file (see updatePhpFile).
 */
export class RouteIndex {
  private compiled: Map<string, RouteInfo> | null = null;
  private yamlRoutes: RouteInfo[] = [];
  private yamlAliases: Array<{ name: string; target: string }> = [];
  private imports: RouteImport[] = [];
  private yamlComplete = true;
  private readonly attributeFiles = new Map<string, RouteExtraction>();
  private merged: Map<string, RouteInfo> | null = null;
  private readonly controllerLocations = new Map<string, Location | null>();
  private autoload: ComposerAutoload;

  constructor(
    private readonly projectRoot: string,
    private readonly parsers: Parsers,
  ) {
    this.autoload = ComposerAutoload.load(projectRoot);
    this.reloadCompiled();
    this.reloadYaml();
  }

  /** Route by name or alias. */
  get(name: string): RouteInfo | undefined {
    return this.routesByName().get(name);
  }

  /** Routes worth proposing: real names, not the `Class::method` / FQCN aliases. */
  visibleRoutes(): RouteInfo[] {
    return [...this.routesByName()].filter(([name, route]) => name === route.name && !/[\\:]/.test(name)).map(([, route]) => route);
  }

  /**
   * True when every route of the project is known: the compiled cache exists (bundle and
   * service-loaded routes) and no source contains a route that cannot be read statically.
   */
  isCertain(): boolean {
    return (
      this.compiled !== null &&
      this.yamlComplete &&
      [...this.attributeFiles.values()].every((extraction) => extraction.complete) &&
      !this.hasPhpRouteConfig()
    );
  }

  /** Where a route's code lives: its declaration, else its controller method (via PSR-4). */
  locationOf(route: RouteInfo): Location | null {
    if (route.location) {
      return route.location;
    }
    if (!route.controller) {
      return null;
    }
    if (!this.controllerLocations.has(route.controller)) {
      this.controllerLocations.set(route.controller, this.findControllerLocation(route.controller));
    }
    return this.controllerLocations.get(route.controller) ?? null;
  }

  reloadCompiled(): void {
    const cacheDir = path.join(this.projectRoot, 'var', 'cache', ROUTING_ENV);
    const generator = readText(path.join(cacheDir, 'url_generating_routes.php'));
    const routes = generator === null ? null : parseCompiledGeneratorRoutes(generator, this.parsers);
    if (routes === null) {
      this.compiled = null;
    } else {
      const matcher = readText(path.join(cacheDir, 'url_matching_routes.php'));
      const methods = matcher === null ? null : parseCompiledMatcherMethods(matcher, this.parsers);
      this.compiled = new Map(routes.map((route) => [route.name, { ...route, methods: methods?.get(route.name) ?? null }]));
    }
    this.merged = null;
  }

  /** Re-reads the routing YAML files, then every attribute file (import prefixes may change). */
  reloadYaml(): void {
    this.yamlRoutes = [];
    this.yamlAliases = [];
    this.imports = [];
    this.yamlComplete = true;
    for (const file of routingYamlFiles(this.projectRoot)) {
      const source = readText(file);
      if (source === null) {
        continue;
      }
      const parsed = parseRouteYaml(source, file, ROUTING_ENV);
      this.yamlRoutes.push(...parsed.routes);
      this.yamlAliases.push(...parsed.aliases);
      this.imports.push(...parsed.imports);
      this.yamlComplete &&= parsed.complete;
    }
    this.attributeFiles.clear();
    for (const file of phpFiles(path.join(this.projectRoot, 'src'))) {
      this.updatePhpFile(file, null);
    }
    this.merged = null;
  }

  /** Composer autoload changed: controller files may have moved. */
  reloadAutoload(): void {
    this.autoload = ComposerAutoload.load(this.projectRoot);
    this.controllerLocations.clear();
  }

  /**
   * Re-extracts the routes of a PHP file of src/, from `content` (open document) or from
   * disk when null. Returns true when the routes of the file changed.
   */
  updatePhpFile(file: string, content: string | null): boolean {
    if (!isInsidePath(file, path.join(this.projectRoot, 'src'))) {
      return false;
    }
    const key = pathKey(file);
    const source = content ?? readText(file);
    const extraction: RouteExtraction =
      source === null
        ? { routes: [], complete: true }
        : extractAttributeRoutes(source, file, ROUTING_ENV, this.parsers, this.prefixesFor(file));
    const previous = this.attributeFiles.get(key);
    if (extraction.routes.length === 0 && extraction.complete) {
      this.attributeFiles.delete(key);
    } else {
      this.attributeFiles.set(key, extraction);
    }
    this.controllerLocations.clear();
    const changed = JSON.stringify(previous ?? null) !== JSON.stringify(this.attributeFiles.get(key) ?? null);
    if (changed) {
      this.merged = null;
    }
    return changed;
  }

  private routesByName(): Map<string, RouteInfo> {
    if (this.merged !== null) {
      return this.merged;
    }
    const merged = new Map<string, RouteInfo>(this.compiled ?? []);
    const sourceRoutes = [...this.yamlRoutes, ...[...this.attributeFiles.values()].flatMap((extraction) => extraction.routes)];
    for (const route of sourceRoutes) {
      const compiled = merged.get(route.name);
      merged.set(route.name, compiled && route.methods === null ? { ...route, methods: compiled.methods } : route);
    }
    for (const route of sourceRoutes) {
      for (const alias of route.aliases) {
        merged.set(alias, route);
      }
    }
    for (const { name, target } of this.yamlAliases) {
      const route = merged.get(target);
      if (route) {
        merged.set(name, route);
      }
    }
    this.merged = merged;
    return merged;
  }

  private prefixesFor(file: string): { prefix: string; namePrefix: string } | null {
    return this.imports.find((entry) => isInsidePath(file, entry.target)) ?? null;
  }

  private hasPhpRouteConfig(): boolean {
    const config = path.join(this.projectRoot, 'config');
    return (
      (!fs.existsSync(path.join(config, 'routes.yaml')) && fs.existsSync(path.join(config, 'routes.php'))) ||
      listFiles(path.join(config, 'routes')).some((file) => file.endsWith('.php')) ||
      listFiles(path.join(config, 'routes', ROUTING_ENV)).some((file) => file.endsWith('.php'))
    );
  }

  /** `App\Controller\X::method` or invokable `App\Controller\X` → method name in its file. */
  private findControllerLocation(controller: string): Location | null {
    const [className, method = '__invoke'] = controller.split('::');
    if (!className || !className.includes('\\')) {
      return null; // service id: needs the container (phase 3)
    }
    const file = this.autoload.findClassFile(className);
    const source = file === null ? null : readText(file);
    if (file === null || source === null) {
      return null;
    }
    const tree = this.parsers.parse('php', source);
    if (tree === null) {
      return null;
    }
    try {
      const shortName = className.split('\\').pop();
      const namespace = fileNamespace(tree.rootNode);
      const declaration = tree.rootNode
        .descendantsOfType('class_declaration')
        .find((node) => node?.childForFieldName('name')?.text === shortName);
      if (!declaration || (namespace ?? '') !== className.split('\\').slice(0, -1).join('\\')) {
        return null;
      }
      const methodNode = declaration
        .childForFieldName('body')
        ?.namedChildren.find((member) => member?.type === 'method_declaration' && member.childForFieldName('name')?.text === method)
        ?.childForFieldName('name');
      const target = methodNode ?? declaration.childForFieldName('name');
      if (!target) {
        return null;
      }
      const document = TextDocument.create(pathToUri(file), 'php', 0, source);
      return Location.create(document.uri, Range.create(document.positionAt(target.startIndex), document.positionAt(target.endIndex)));
    } finally {
      tree.delete();
    }
  }
}

/** MicroKernelTrait::configureRoutes() order: routes/<env>/, routes/, then routes.yaml. */
function routingYamlFiles(projectRoot: string): string[] {
  const config = path.join(projectRoot, 'config');
  const yaml = (dir: string): string[] => listFiles(dir).filter((file) => /\.ya?ml$/.test(file)).sort();
  return [
    ...yaml(path.join(config, 'routes', ROUTING_ENV)),
    ...yaml(path.join(config, 'routes')),
    ...[path.join(config, 'routes.yaml')].filter((file) => fs.existsSync(file)),
  ];
}

function phpFiles(dir: string): string[] {
  const files: string[] = [];
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
        pending.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.php')) {
        files.push(full);
      }
    }
  }
  return files.sort();
}

function listFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
