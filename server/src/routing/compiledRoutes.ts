import type { Node } from 'web-tree-sitter';
import type { Parsers } from '../parsing/parsers';
import { phpString, phpValue, UNKNOWN } from '../parsing/phpValues';
import { pathFromTokens } from './routePath';
import type { RouteInfo } from './types';

/**
 * Routes of var/cache/<env>/url_generating_routes.php (CompiledUrlGeneratorDumper):
 * `'name' => [variables, defaults, requirements, tokens, hostTokens, schemes, deprecations]`.
 * Aliases are dumped as regular entries. Methods are not part of this file.
 */
export function parseCompiledGeneratorRoutes(source: string, parsers: Parsers): RouteInfo[] | null {
  return withReturnedArray(source, parsers, (array) => {
    const routes: RouteInfo[] = [];
    for (const element of array.namedChildren) {
      const [key, value] = element?.namedChildren ?? [];
      const name = phpString(key);
      const tuple = value ? phpValue(value) : UNKNOWN;
      if (name === null || !Array.isArray(tuple)) {
        continue;
      }
      const [, defaults, , tokens] = tuple;
      const controller =
        defaults && typeof defaults === 'object' && !Array.isArray(defaults) && typeof defaults['_controller'] === 'string'
          ? defaults['_controller']
          : null;
      routes.push({ name, path: pathFromTokens(tokens), methods: null, controller, location: null, aliases: [] });
    }
    return routes;
  });
}

/**
 * HTTP methods per route from var/cache/<env>/url_matching_routes.php (CompiledUrlMatcherDumper).
 * Static and dynamic routes share the tuple shape `[defaults (with _route), x, methods, ...]`,
 * where methods is null (any) or `['GET' => 0, ...]`.
 */
export function parseCompiledMatcherMethods(source: string, parsers: Parsers): Map<string, string[]> | null {
  return withReturnedArray(source, parsers, (array) => {
    const methods = new Map<string, string[]>();
    for (const element of array.descendantsOfType('array_element_initializer')) {
      const [key, value] = element?.namedChildren ?? [];
      if (phpString(key) !== '_route') {
        continue;
      }
      const name = phpString(value);
      // element → defaults array → its initializer → route tuple
      const tuple = element?.parent?.parent?.parent;
      const methodsNode = tuple?.type === 'array_creation_expression' ? tuple.namedChildren[2]?.namedChildren[0] : undefined;
      const allowed = methodsNode ? phpValue(methodsNode) : UNKNOWN;
      if (name === null) {
        continue;
      }
      if (allowed === null) {
        methods.set(name, []);
      } else if (allowed && typeof allowed === 'object' && !Array.isArray(allowed)) {
        methods.set(name, Object.keys(allowed));
      }
    }
    return methods;
  });
}

function withReturnedArray<T>(source: string, parsers: Parsers, read: (array: Node) => T): T | null {
  const tree = parsers.parse('php', source);
  if (tree === null) {
    return null;
  }
  try {
    const array = tree.rootNode.descendantsOfType('return_statement')[0]?.namedChildren[0];
    return array?.type === 'array_creation_expression' ? read(array) : null;
  } finally {
    tree.delete();
  }
}
