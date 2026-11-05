import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseDocument } from 'yaml';

export interface TwigPathEntry {
  /** Absolute directory. */
  dir: string;
  /** Namespace without `@`, or null for the main namespace. */
  namespace: string | null;
}

/**
 * The `twig` configuration relevant to template loading, merged from the YAML files of
 * config/packages/ then config/packages/<env>/, each followed by its `when@<env>` block
 * (the order MicroKernelTrait loads them in). PHP config files are not read.
 */
export class TwigConfig {
  private constructor(
    /** Absolute default_path, or null when it cannot be resolved statically. */
    readonly defaultPath: string | null,
    /** twig.paths in registration order. */
    readonly paths: readonly TwigPathEntry[],
    /** Problems worth logging (unreadable files, unresolved parameters). */
    readonly warnings: readonly string[],
  ) {}

  static load(projectRoot: string, env: string): TwigConfig {
    const warnings: string[] = [];
    let defaultPath: string | null = path.join(projectRoot, 'templates');
    const paths = new Map<string, string | null>();

    const packagesDir = path.join(projectRoot, 'config', 'packages');
    for (const file of [...yamlFiles(packagesDir), ...yamlFiles(path.join(packagesDir, env))]) {
      const document = parseDocument(fs.readFileSync(file, 'utf8'));
      if (document.errors.length > 0) {
        warnings.push(`Cannot parse ${file}: ${document.errors[0]?.message ?? 'unknown error'}`);
        continue;
      }
      const content: unknown = document.toJS();
      if (!isRecord(content)) {
        continue;
      }
      const envBlock = content[`when@${env}`];
      for (const twig of [content['twig'], isRecord(envBlock) ? envBlock['twig'] : undefined]) {
        if (!isRecord(twig)) {
          continue;
        }
        if ('default_path' in twig) {
          defaultPath = resolveConfigPath(twig['default_path'], projectRoot);
          if (defaultPath === null) {
            warnings.push(`Unresolved twig.default_path in ${file}`);
          }
        }
        for (const [rawPath, namespace] of normalizePaths(twig['paths'])) {
          paths.set(rawPath, namespace);
        }
      }
    }

    const entries: TwigPathEntry[] = [];
    for (const [rawPath, namespace] of paths) {
      const dir = resolveConfigPath(rawPath, projectRoot);
      if (dir === null) {
        warnings.push(`Unresolved twig path ${rawPath}`);
        continue;
      }
      entries.push({ dir, namespace });
    }
    return new TwigConfig(defaultPath, entries, warnings);
  }
}

/**
 * twig.paths accepts a map (`path: namespace`, null for the main namespace) or a list
 * of paths in the main namespace (Configuration::beforeNormalization).
 */
function normalizePaths(value: unknown): Array<[string, string | null]> {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map((item) => [item, null]);
  }
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, namespace]): Array<[string, string | null]> => {
    if (/^\d+$/.test(key)) {
      return typeof namespace === 'string' ? [[namespace, null]] : [];
    }
    if (namespace === null || namespace === undefined || namespace === '') {
      return [[key, null]];
    }
    return typeof namespace === 'string' ? [[key, namespace]] : [];
  });
}

/**
 * Resolves %kernel.project_dir%; relative paths are relative to the project root
 * (the Twig loader's root path). Any other parameter cannot be resolved statically.
 */
function resolveConfigPath(value: unknown, projectRoot: string): string | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const replaced = value.replace(/%kernel\.project_dir%/g, projectRoot);
  return /%[^%]+%/.test(replaced) ? null : path.resolve(projectRoot, replaced);
}

function yamlFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
