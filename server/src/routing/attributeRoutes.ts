import { Location, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Node } from 'web-tree-sitter';
import type { Parsers } from '../parsing/parsers';
import { fileNamespace, resolveClassName } from '../parsing/phpNames';
import { phpValue, UNKNOWN, type MaybePhpValue } from '../parsing/phpValues';
import { pathToUri } from '../util/paths';
import { addPathPrefix, normalizeRoutePath } from './routePath';
import type { RouteExtraction, RouteInfo } from './types';

const ROUTE_ATTRIBUTE_CLASSES = new Set([
  'Symfony\\Component\\Routing\\Attribute\\Route',
  'Symfony\\Component\\Routing\\Annotation\\Route',
]);

/** Route::__construct() parameters, in positional order. */
const ROUTE_PARAMETERS = [
  'path', 'name', 'requirements', 'options', 'defaults', 'host', 'methods', 'schemes', 'condition',
  'priority', 'locale', 'format', 'utf8', 'stateless', 'env', 'alias',
];

interface Globals {
  name: string;
  path: string;
  methods: string[] | null;
  envs: string[];
}

/** A #[Route] attribute and its arguments keyed by parameter name. */
interface RouteAttribute {
  node: Node;
  args: Map<string, MaybePhpValue>;
}

const NO_GLOBALS: Globals = { name: '', path: '', methods: [], envs: [] };

/** Prefixes added by the YAML import that loads the file (`prefix`, `name_prefix`). */
export interface ImportPrefixes {
  prefix: string;
  namePrefix: string;
}

/**
 * Routes declared with #[Route] in a PHP file, following AttributeClassLoader and
 * FrameworkBundle's AttributeRouteControllerLoader (Symfony 7.4):
 * - class-level #[Route] gives name/path prefixes and methods; its `env` filters the class;
 * - a method may carry several routes; unnamed ones get the default name;
 * - an invokable class without method routes uses the class-level attributes;
 * - `Class::method` (and the FQCN for invokables) become aliases of a lone route.
 * Routes whose name, path or env is not a literal are skipped and make the result incomplete.
 */
export function extractAttributeRoutes(
  source: string,
  file: string,
  env: string,
  parsers: Parsers,
  prefixes: ImportPrefixes | null = null,
): RouteExtraction {
  if (!source.includes('Route')) {
    return { routes: [], complete: true };
  }
  const tree = parsers.parse('php', source);
  if (tree === null) {
    return { routes: [], complete: false };
  }
  try {
    const root = tree.rootNode;
    const document = TextDocument.create(pathToUri(file), 'php', 0, source);
    const routes: RouteInfo[] = [];
    let complete = true;
    const namespace = fileNamespace(root);

    for (const declaration of root.descendantsOfType('class_declaration')) {
      const shortName = declaration?.childForFieldName('name')?.text;
      if (!declaration || !shortName || declaration.namedChildren.some((child) => child?.type === 'abstract_modifier')) {
        continue;
      }
      const className = namespace ? `${namespace}\\${shortName}` : shortName;
      const classAttributes = routeAttributes(declaration, root);
      const globals = classAttributes[0] ? readGlobals(classAttributes[0]) : NO_GLOBALS;
      if (globals === null) {
        complete = false;
        continue;
      }
      if (globals.envs.length > 0 && !globals.envs.includes(env)) {
        continue;
      }

      const methods = (declaration.childForFieldName('body')?.namedChildren ?? []).filter(
        (member): member is Node => member?.type === 'method_declaration',
      );
      const classRoutes: RouteInfo[] = [];
      let invokable = false;

      for (const method of methods) {
        const methodName = method.childForFieldName('name')?.text;
        if (!methodName) {
          continue;
        }
        let defaultIndex = 0;
        const before = classRoutes.length;
        for (const attribute of routeAttributes(method, root)) {
          const built = buildRoute(attribute, globals, className, methodName, env, document, () =>
            defaultRouteName(className, methodName, defaultIndex++),
          );
          complete &&= built.complete;
          if (built.route) {
            classRoutes.push(built.route);
            invokable ||= methodName === '__invoke';
          }
        }
        const added = classRoutes.slice(before);
        if (added.length === 1) {
          addAlias(added[0]!, `${className}::${methodName}`);
        }
      }

      if (classRoutes.length === 0 && methods.some((method) => method.childForFieldName('name')?.text === '__invoke')) {
        let defaultIndex = 0;
        for (const attribute of classAttributes) {
          const built = buildRoute(attribute, NO_GLOBALS, className, '__invoke', env, document, () =>
            defaultRouteName(className, '__invoke', defaultIndex++),
          );
          complete &&= built.complete;
          if (built.route) {
            classRoutes.push(built.route);
            invokable = true;
          }
        }
      }
      if (invokable && classRoutes.length === 1) {
        addAlias(classRoutes[0]!, className);
        addAlias(classRoutes[0]!, `${className}::__invoke`);
      }
      routes.push(...classRoutes);
    }

    return { routes: prefixes ? routes.map((route) => withPrefixes(route, prefixes)) : routes, complete };
  } finally {
    tree.delete();
  }
}

/** AttributeClassLoader::getDefaultRouteName() as overridden by FrameworkBundle. */
export function defaultRouteName(className: string, method: string, index: number): string {
  let name = `${className.replace(/\\/g, '_')}_${method}`.toLowerCase();
  if (index > 0) {
    name += `_${index}`;
  }
  name = name.replace(/(bundle|controller)_/g, '_');
  if (method.endsWith('Action') || method.endsWith('_action')) {
    name = name.replace(/action(_\d+)?$/, '$1');
  }
  return name.replace(/__/g, '_');
}

function buildRoute(
  attribute: RouteAttribute,
  globals: Globals,
  className: string,
  methodName: string,
  env: string,
  document: TextDocument,
  nextDefaultName: () => string,
): { route?: RouteInfo; complete: boolean } {
  const envs = stringList(attribute.args.get('env'));
  if (envs === null) {
    return { complete: false };
  }
  if (envs.length > 0 && !envs.includes(env)) {
    return { complete: true };
  }
  const name = optionalString(attribute.args.get('name'));
  const path = optionalString(attribute.args.get('path'));
  if (name === UNKNOWN || path === UNKNOWN) {
    return { complete: false };
  }
  const ownMethods = stringList(attribute.args.get('methods'));
  const aliases = stringList(attribute.args.get('alias'));
  const node = attribute.node;

  const route: RouteInfo = {
    name: globals.name + (name ?? nextDefaultName()),
    path: normalizeRoutePath(globals.path + (path ?? '')),
    methods:
      globals.methods === null || ownMethods === null
        ? null
        : [...new Set([...globals.methods, ...ownMethods].map((method) => method.toUpperCase()))],
    controller: methodName === '__invoke' ? className : `${className}::${methodName}`,
    location: Location.create(
      document.uri,
      Range.create(document.positionAt(node.startIndex), document.positionAt(node.endIndex)),
    ),
    aliases: aliases ?? [],
  };
  return { route, complete: aliases !== null };
}

function readGlobals(attribute: RouteAttribute): Globals | null {
  const name = optionalString(attribute.args.get('name'));
  const path = optionalString(attribute.args.get('path'));
  const envs = stringList(attribute.args.get('env'));
  if (name === UNKNOWN || path === UNKNOWN || envs === null) {
    return null;
  }
  return { name: name ?? '', path: path ?? '', methods: stringList(attribute.args.get('methods')), envs };
}

/** #[Route] attributes of a class or method. */
function routeAttributes(owner: Node, root: Node): RouteAttribute[] {
  const result: RouteAttribute[] = [];
  for (const list of owner.namedChildren) {
    if (list?.type !== 'attribute_list') {
      continue;
    }
    for (const attribute of list.descendantsOfType('attribute')) {
      const name = attribute?.namedChildren[0];
      if (!attribute || !name || !ROUTE_ATTRIBUTE_CLASSES.has(resolveClassName(name.text, root))) {
        continue;
      }
      const args = new Map<string, MaybePhpValue>();
      const argumentNodes = (attribute.childForFieldName('parameters')?.namedChildren ?? []).filter(
        (child): child is Node => child?.type === 'argument',
      );
      argumentNodes.forEach((argument, index) => {
        const named = argument.childForFieldName('name')?.text;
        const valueNode = argument.namedChildren[argument.namedChildren.length - 1];
        const key = named ?? ROUTE_PARAMETERS[index];
        if (key && valueNode && valueNode !== argument.childForFieldName('name')) {
          args.set(key, phpValue(valueNode));
        } else {
          // Spread or malformed argument: nothing about this attribute can be trusted.
          ROUTE_PARAMETERS.forEach((parameter) => args.set(parameter, UNKNOWN));
        }
      });
      result.push({ node: attribute, args });
    }
  }
  return result;
}

/** string → value, absent/null → null, anything else → UNKNOWN. */
function optionalString(value: MaybePhpValue | undefined): string | null | typeof UNKNOWN {
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === 'string' ? value : UNKNOWN;
}

/** `'GET'` or `['GET', 'POST']` → list; absent/null → []; anything else → null (unknown). */
function stringList(value: MaybePhpValue | undefined): string[] | null {
  if (value === undefined || value === null) {
    return [];
  }
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) {
    return value;
  }
  return null;
}

function addAlias(route: RouteInfo, alias: string): void {
  if (alias !== route.name && !route.aliases.includes(alias)) {
    route.aliases = [...route.aliases, alias];
  }
}

function withPrefixes(route: RouteInfo, prefixes: ImportPrefixes): RouteInfo {
  return {
    ...route,
    name: prefixes.namePrefix + route.name,
    path: route.path === null ? null : addPathPrefix(prefixes.prefix, route.path),
    aliases: route.aliases.map((alias) => prefixes.namePrefix + alias),
  };
}
