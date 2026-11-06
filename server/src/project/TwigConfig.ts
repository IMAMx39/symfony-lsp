import * as fs from 'node:fs';
import * as path from 'node:path';
import { isRecord, readPackageConfigs, resolveConfigPath } from './packageConfig';

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
    /** Namespaces (null: main) with a path that could not be resolved: their list is incomplete. */
    readonly incompleteNamespaces: ReadonlySet<string | null>,
    /** False when part of the configuration cannot be read (PHP config, unparsable YAML). */
    readonly complete: boolean,
  ) {}

  static load(projectRoot: string, env: string): TwigConfig {
    const warnings: string[] = [];
    let defaultPath: string | null = path.join(projectRoot, 'templates');
    const paths = new Map<string, string | null>();
    const incompleteNamespaces = new Set<string | null>();
    let complete = true;

    const packagesDir = path.join(projectRoot, 'config', 'packages');
    for (const phpConfig of [path.join(packagesDir, 'twig.php'), path.join(packagesDir, env, 'twig.php')]) {
      if (fs.existsSync(phpConfig)) {
        complete = false;
        warnings.push(`${phpConfig} is not read: PHP configuration requires running PHP`);
      }
    }
    const configs = readPackageConfigs(projectRoot, env);
    for (const { file, message } of configs.invalid) {
      complete = false;
      warnings.push(`Cannot parse ${file}: ${message}`);
    }
    for (const { file, content } of configs.blocks) {
      const twig = content['twig'];
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

    const entries: TwigPathEntry[] = [];
    for (const [rawPath, namespace] of paths) {
      const dir = resolveConfigPath(rawPath, projectRoot);
      if (dir === null) {
        incompleteNamespaces.add(namespace);
        warnings.push(`Unresolved twig path ${rawPath}`);
        continue;
      }
      entries.push({ dir, namespace });
    }
    return new TwigConfig(defaultPath, entries, warnings, incompleteNamespaces, complete && defaultPath !== null);
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
