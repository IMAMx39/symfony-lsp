import * as fs from 'node:fs';
import * as path from 'node:path';
import { Location, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { isMap, isScalar, parseDocument, type Pair, type YAMLMap } from 'yaml';
import { pathToUri } from '../util/paths';
import { normalizeRoutePath } from './routePath';
import type { RouteImport, RouteInfo } from './types';

export interface YamlRouteFile {
  routes: RouteInfo[];
  /** Imports of attribute routes from a directory or PHP file, with their prefixes. */
  imports: RouteImport[];
  /** Route aliases (`name: { alias: target }`), resolved by the index across files. */
  aliases: Array<{ name: string; target: string }>;
  /** False when part of the file could not be understood statically. */
  complete: boolean;
}

/**
 * Routes and attribute imports of a routing YAML file (YamlFileLoader), including the
 * `when@<env>` block. Imports of bundle resources (`@FooBundle/...`) and service loaders
 * (`routing.controllers`, `security.route_loader.logout`) are left to the compiled cache.
 */
export function parseRouteYaml(source: string, file: string, env: string): YamlRouteFile {
  const result: YamlRouteFile = { routes: [], imports: [], aliases: [], complete: true };
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    return { ...result, complete: false };
  }
  if (!isMap(document.contents)) {
    return result;
  }
  const text = TextDocument.create(pathToUri(file), 'yaml', 0, source);
  for (const pair of document.contents.items) {
    const key = scalarString(pair.key);
    if (key === `when@${env}`) {
      if (isMap(pair.value)) {
        pair.value.items.forEach((item) => readEntry(item, file, text, result));
      }
    } else if (key !== null && !key.startsWith('when@')) {
      readEntry(pair, file, text, result);
    }
  }
  return result;
}

function readEntry(pair: Pair, file: string, text: TextDocument, result: YamlRouteFile): void {
  const name = scalarString(pair.key);
  if (name === null || !isMap(pair.value)) {
    result.complete = false;
    return;
  }
  const config = pair.value;
  if (config.has('resource')) {
    readImport(config, file, result);
    return;
  }
  if (config.has('alias')) {
    const target = scalarString(config.get('alias', true));
    if (target === null) {
      result.complete = false;
    } else {
      result.aliases.push({ name, target });
    }
    return;
  }
  const routePath = config.get('path');
  if (typeof routePath !== 'string') {
    // Localized paths (map) or missing path.
    result.complete = false;
    return;
  }
  const defaults = config.get('defaults');
  const controller = scalarString(config.get('controller', true)) ?? (isMap(defaults) ? scalarString(defaults.get('_controller', true)) : null);
  const range = (pair.key as { range?: [number, number, number] } | null)?.range;
  result.routes.push({
    name,
    path: normalizeRoutePath(routePath),
    methods: yamlMethods(config.get('methods')),
    controller,
    location: range ? Location.create(text.uri, Range.create(text.positionAt(range[0]), text.positionAt(range[1]))) : null,
    aliases: [],
  });
}

function readImport(config: YAMLMap, file: string, result: YamlRouteFile): void {
  const resource = config.get('resource');
  const resourcePath = typeof resource === 'string' ? resource : isMap(resource) ? resource.get('path') : null;
  const prefix = config.get('prefix') ?? '';
  const namePrefix = config.get('name_prefix') ?? '';
  if (typeof resourcePath !== 'string' || typeof prefix !== 'string' || typeof namePrefix !== 'string') {
    result.complete = false;
    return;
  }
  // Bundle resources and service loaders are only known through the compiled cache.
  const isFileLike = /[\\/]/.test(resourcePath) || /\.(ya?ml|xml|php)$/.test(resourcePath);
  if (resourcePath.startsWith('@') || !isFileLike) {
    return;
  }
  if (/[*?{[]/.test(resourcePath)) {
    result.complete = false;
    return;
  }
  const target = path.resolve(path.dirname(file), resourcePath);
  if (isDirectory(target) || target.endsWith('.php')) {
    result.imports.push({ target, prefix, namePrefix });
  } else {
    // Nested YAML/XML route files are not followed.
    result.complete = false;
  }
}

/** `GET|POST`, `[GET, POST]` → upper-cased list; absent → [] (any); unreadable → null. */
function yamlMethods(value: unknown): string[] | null {
  if (value === undefined || value === null) {
    return [];
  }
  if (typeof value === 'string') {
    return value.split('|').map((method) => method.trim().toUpperCase()).filter((method) => method !== '');
  }
  if (value && typeof value === 'object' && 'items' in value && Array.isArray(value.items)) {
    const items = (value.items as unknown[]).map((item) => scalarString(item));
    return items.every((item): item is string => item !== null) ? items.map((method) => method.toUpperCase()) : null;
  }
  return null;
}

function scalarString(node: unknown): string | null {
  if (isScalar(node)) {
    return typeof node.value === 'string' ? node.value : null;
  }
  return typeof node === 'string' ? node : null;
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
