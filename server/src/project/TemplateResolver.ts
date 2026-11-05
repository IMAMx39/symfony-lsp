import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SymfonyProject } from './SymfonyProject';

/**
 * Resolves Twig template names to files.
 *
 * Matching is case-sensitive on every platform: the project runs in a Linux
 * container, where `Home/index.html.twig` does not find `home/index.html.twig`
 * even if the Windows host filesystem would.
 */
export class TemplateResolver {
  constructor(private readonly roots: readonly string[]) {}

  static forProject(project: SymfonyProject): TemplateResolver {
    return new TemplateResolver([path.join(project.root, 'templates')]);
  }

  resolve(name: string): string | null {
    const segments = splitTemplateName(name);
    if (segments === null) {
      return null;
    }
    for (const root of this.roots) {
      const file = findExactFile(root, segments);
      if (file !== null) {
        return file;
      }
    }
    return null;
  }
}

/**
 * Splits a template name into path segments, the way Twig normalizes it
 * (backslashes become `/`, repeated slashes collapse).
 * Returns null for names this resolver does not handle.
 */
export function splitTemplateName(name: string): string[] | null {
  if (name.startsWith('@')) {
    return null;
  }
  const segments = name
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.includes('..') || name.includes('\0')) {
    return null;
  }
  return segments;
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
