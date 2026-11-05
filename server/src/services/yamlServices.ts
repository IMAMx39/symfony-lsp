import { Location, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { isMap, isScalar, isSeq, parseDocument, type Document, type Pair } from 'yaml';
import { pathToUri } from '../util/paths';
import type { ServiceInfo } from './types';

/** Keys of a service definition whose values YamlFileLoader resolves as references (`@id`). */
const REFERENCE_KEYS = new Set(['arguments', 'properties', 'calls', 'configurator', 'factory', 'bind']);

/** Same shape as the class names ResolveClassPass accepts as a service id (namespaced only). */
const NAMESPACED_CLASS = /^[A-Za-z_\x7f-￿][\w\x7f-￿]*(?:\\[A-Za-z_\x7f-￿][\w\x7f-￿]*)+$/;

/** A quoted `'@id'` reference. `start`/`end` cover the quotes, `idStart`/`idEnd` the id alone. */
export interface ServiceReference {
  id: string;
  start: number;
  end: number;
  idStart: number;
  idEnd: number;
}

/**
 * Services declared with an explicit key under `services:` (and `when@<env>: services:`).
 * `_defaults`, `_instanceof` and resource prototypes (`App\: { resource: ... }`) declare no id.
 * Returns null when the file is not valid YAML.
 */
export function parseServicesYaml(source: string, file: string, env: string): ServiceInfo[] | null {
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    return null;
  }
  const text = TextDocument.create(pathToUri(file), 'yaml', 0, source);
  const services: ServiceInfo[] = [];
  for (const pair of serviceEntries(document, env)) {
    const id = scalarString(pair.key);
    if (id === null || id === '_defaults' || id === '_instanceof') {
      continue;
    }
    const definition = readDefinition(id, pair.value);
    if (definition === null) {
      continue;
    }
    const range = (pair.key as { range?: [number, number, number] }).range;
    services.push({
      id,
      ...definition,
      location: range ? Location.create(text.uri, Range.create(text.positionAt(range[0]), text.positionAt(range[1]))) : null,
    });
  }
  return services;
}

/**
 * `'@id'`, `'@?id'` and `'@!id'` literals where YamlFileLoader resolves references: the short
 * alias syntax (`foo: '@bar'`) and the values of arguments, properties, calls, configurator,
 * factory and bind. `@@` (escaped `@`), `@=` (expression), escapes and unquoted scalars are
 * skipped. Works on files being edited: whatever parsed is used.
 */
export function findServiceReferences(source: string, env: string): ServiceReference[] {
  const document = parseDocument(source);
  const references: ServiceReference[] = [];
  const collect = (node: unknown): void => collectReferences(node, source, references);
  for (const pair of serviceEntries(document, env)) {
    const id = scalarString(pair.key);
    if (id === '_instanceof' && isMap(pair.value)) {
      pair.value.items.forEach((item) => scanDefinition(item.value, collect));
    } else if (isScalar(pair.value)) {
      collect(pair.value);
    } else {
      scanDefinition(pair.value, collect);
    }
  }
  return references;
}

function serviceEntries(document: Document, env: string): Pair[] {
  if (!isMap(document.contents)) {
    return [];
  }
  const entries: Pair[] = [];
  for (const pair of document.contents.items) {
    const key = scalarString(pair.key);
    const services =
      key === 'services' ? pair.value : key === `when@${env}` && isMap(pair.value) ? pair.value.get('services', true) : null;
    if (isMap(services)) {
      entries.push(...services.items);
    }
  }
  return entries;
}

function readDefinition(id: string, value: unknown): Pick<ServiceInfo, 'class' | 'alias'> | null {
  const implicitClass = NAMESPACED_CLASS.test(id) ? id : null;
  if (value === null || (isScalar(value) && value.value === null)) {
    return { class: implicitClass, alias: null };
  }
  if (isScalar(value)) {
    // Short alias syntax: `foo: '@bar'`.
    return typeof value.value === 'string' && value.value.startsWith('@') ? { class: null, alias: value.value.slice(1) } : null;
  }
  if (!isMap(value) || value.has('resource')) {
    return null;
  }
  if (value.has('alias')) {
    const alias = scalarString(value.get('alias', true));
    return alias === null ? null : { class: null, alias };
  }
  const explicitClass = scalarString(value.get('class', true))?.replace(/^\\/, '') ?? null;
  // A child definition inherits the class of its parent: unknown from the YAML alone.
  return { class: explicitClass ?? (value.has('parent') ? null : implicitClass), alias: null };
}

function scanDefinition(definition: unknown, collect: (node: unknown) => void): void {
  if (!isMap(definition)) {
    return;
  }
  for (const pair of definition.items) {
    const key = scalarString(pair.key);
    if (key !== null && REFERENCE_KEYS.has(key)) {
      collect(pair.value);
    }
  }
}

function collectReferences(node: unknown, source: string, references: ServiceReference[]): void {
  if (isMap(node)) {
    // Only values: a key is never resolved as a reference.
    node.items.forEach((pair) => collectReferences(pair.value, source, references));
  } else if (isSeq(node)) {
    node.items.forEach((item) => collectReferences(item, source, references));
  } else if (isScalar(node)) {
    const reference = referenceOf(node, source);
    if (reference !== null) {
      references.push(reference);
    }
  }
}

function referenceOf(node: { type?: string; value: unknown; range?: [number, number, number] | null }, source: string): ServiceReference | null {
  if ((node.type !== 'QUOTE_SINGLE' && node.type !== 'QUOTE_DOUBLE') || typeof node.value !== 'string' || !node.range) {
    return null;
  }
  const [start, end] = node.range;
  const quote = source[start];
  const raw = source.slice(start + 1, end - 1);
  // Unterminated literal, or escapes (`''`, `\x`) that make the source differ from the value.
  if (end - start < 2 || source[end - 1] !== quote || raw !== node.value) {
    return null;
  }
  if (!raw.startsWith('@') || raw.startsWith('@@') || raw.startsWith('@=')) {
    return null;
  }
  const prefixLength = raw.startsWith('@?') || raw.startsWith('@!') ? 2 : 1;
  return { id: raw.slice(prefixLength), start, end, idStart: start + 1 + prefixLength, idEnd: end - 1 };
}

function scalarString(node: unknown): string | null {
  return isScalar(node) && typeof node.value === 'string' ? node.value : null;
}
