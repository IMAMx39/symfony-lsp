import * as fs from 'node:fs';
import * as path from 'node:path';
import { MAIN_NAMESPACE } from './TwigLoaderPaths';

export interface TemplateName {
  /** Namespace without `@` (`!Foo` for `@!Foo`), or MAIN_NAMESPACE. */
  namespace: string;
  segments: string[];
}

/**
 * Resolves Twig template names to files, like Twig's FilesystemLoader: each directory of
 * the template's namespace is tried in order, the first existing file wins.
 *
 * Matching is case-sensitive on every platform: the project runs in a Linux
 * container, where `Home/index.html.twig` does not find `home/index.html.twig`
 * even if the Windows host filesystem would.
 */
export class TemplateResolver {
  constructor(private readonly namespaces: ReadonlyMap<string, readonly string[]>) {}

  resolve(name: string): string | null {
    const parsed = parseTemplateName(name);
    if (parsed === null) {
      return null;
    }
    for (const root of this.namespaces.get(parsed.namespace) ?? []) {
      const file = findExactFile(root, parsed.segments);
      if (file !== null) {
        return file;
      }
    }
    return null;
  }
}

/**
 * Parses a template name the way Twig does (FilesystemLoader::normalizeName + parseName):
 * backslashes become `/`, repeated slashes collapse, `@Ns/rest` selects a namespace.
 * Returns null for invalid names and for `..` segments (never resolved here).
 */
export function parseTemplateName(name: string): TemplateName | null {
  if (name.includes('\0')) {
    return null;
  }
  let normalized = name.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  let namespace = MAIN_NAMESPACE;
  if (normalized.startsWith('@')) {
    const slash = normalized.indexOf('/');
    if (slash <= 1) {
      return null;
    }
    namespace = normalized.slice(1, slash);
    normalized = normalized.slice(slash + 1);
  }
  const segments = normalized.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.includes('..')) {
    return null;
  }
  return { namespace, segments };
}

function findExactFile(root: string, segments: readonly string[]): string | null {
  let current = root;
  for (const segment of segments) {
    if (!listNames(current).includes(segment)) {
      return null;
    }
    current = path.join(current, segment);
  }
  return isFile(current) ? current : null;
}

function listNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
