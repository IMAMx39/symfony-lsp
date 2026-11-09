import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Location } from 'vscode-languageserver';
import type { Parsers } from '../parsing/parsers';
import { ComposerAutoload } from '../project/ComposerAutoload';
import { locateClass } from '../project/classLocation';
import { extractAttributeRoutes } from '../routing/attributeRoutes';
import { parseCompiledGeneratorRoutes, parseCompiledMatcherMethods } from '../routing/compiledRoutes';
import type { RouteExtraction, RouteImport, RouteInfo } from '../routing/types';
import { parseRouteYaml } from '../routing/yamlRoutes';
import { isInsidePath, pathKey } from '../util/paths';
import { phpFiles } from '../util/phpFiles';

/** Environment whose routes are mirrored (the one developers run). */
export const ROUTING_ENV = 'dev';

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
    // A controller without namespace is a service id: resolved through the container (phase 3).
    return className ? locateClass(this.autoload, this.parsers, className, method) : null;
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
