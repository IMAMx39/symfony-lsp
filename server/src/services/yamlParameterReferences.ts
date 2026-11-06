import { isMap, isScalar, isSeq, parseDocument, type Scalar } from 'yaml';
import { findPlaceholders, type ParameterReference } from './parameterPlaceholders';

/**
 * Keys of a route (or import) whose values the Router resolves parameters in
 * (FrameworkBundle Router::resolveParameters: defaults, requirements, path, host, schemes,
 * methods, condition), including the YAML keys that become defaults or requirements
 * (`controller`, `locale`, `format`) or part of the path (`prefix`).
 */
const ROUTE_KEYS = new Set(['path', 'host', 'defaults', 'requirements', 'schemes', 'methods', 'condition', 'controller', 'locale', 'format', 'prefix']);

/** Where placeholders are resolved: every value (services, packages) or only route values. */
export type YamlParameterScope = 'all' | 'routes';

/**
 * `%name%` placeholders in the string values of a YAML configuration file (keys are not
 * resolved). Only scalars whose source text is their value are read: plain or quoted without
 * escapes, on one line; block scalars are skipped. `%%` is an escaped `%`; `%env(...)%`
 * placeholders are environment variables, not parameters. Works on files being edited.
 */
export function findYamlParameterReferences(source: string, scope: YamlParameterScope): ParameterReference[] {
  const document = parseDocument(source);
  const references: ParameterReference[] = [];
  const collect = (node: unknown): void => {
    if (isMap(node)) {
      node.items.forEach((pair) => collect(pair.value));
    } else if (isSeq(node)) {
      node.items.forEach(collect);
    } else if (isScalar(node)) {
      scalarReferences(node, source, references);
    }
  };
  const root = document.contents;
  if (scope === 'all') {
    collect(root);
  } else if (isMap(root)) {
    for (const pair of root.items) {
      const name = isScalar(pair.key) ? String(pair.key.value) : '';
      const routes = name.startsWith('when@') && isMap(pair.value) ? pair.value.items.map((item) => item.value) : [pair.value];
      for (const route of routes) {
        if (isMap(route)) {
          route.items.filter((item) => isScalar(item.key) && ROUTE_KEYS.has(String(item.key.value))).forEach((item) => collect(item.value));
        }
      }
    }
  }
  return references;
}

function scalarReferences(node: Scalar, source: string, references: ParameterReference[]): void {
  if (typeof node.value !== 'string' || !node.range) {
    return;
  }
  const raw = source.slice(node.range[0], node.range[1]);
  const quoted = node.type === 'QUOTE_SINGLE' || node.type === 'QUOTE_DOUBLE';
  if ((!quoted && node.type !== 'PLAIN') || raw.includes('\n')) {
    return;
  }
  const content = quoted ? raw.slice(1, -1) : raw;
  if (content !== node.value) {
    return;
  }
  const contentStart = node.range[0] + (quoted ? 1 : 0);
  for (const placeholder of findPlaceholders(content)) {
    if (placeholder.name.startsWith('env(')) {
      continue;
    }
    references.push({
      name: placeholder.name,
      start: contentStart + placeholder.start,
      end: contentStart + placeholder.nameEnd + (placeholder.closed ? 1 : 0),
      nameStart: contentStart + placeholder.nameStart,
      nameEnd: contentStart + placeholder.nameEnd,
      closed: placeholder.closed,
    });
  }
}
