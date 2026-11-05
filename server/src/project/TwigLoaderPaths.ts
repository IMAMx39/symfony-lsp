import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Parsers } from '../parsing/parsers';
import { bundleRootDir, enabledBundles } from './bundles';
import { ComposerAutoload } from './ComposerAutoload';
import { TwigConfig } from './TwigConfig';

/** Twig's FilesystemLoader::MAIN_NAMESPACE. */
export const MAIN_NAMESPACE = '__main__';

/** Environment whose configuration is mirrored (the one developers run). */
export const KERNEL_ENV = 'dev';

/**
 * Namespaced template directories, in the order Twig's FilesystemLoader receives them.
 * Mirrors TwigBundle 7.x:
 * 1. twig.paths, in configuration order (TwigExtension::load);
 * 2. for each enabled bundle: `<default_path>/bundles/<Name>Bundle`, then the bundle's
 *    `Resources/views` or `templates`; `@!Name` gets the last of them;
 * 3. default_path, in the main namespace;
 * 4. twig-bridge views added by ExtensionPass: `@email` (symfony/mailer installed) and the
 *    form themes in the main namespace (symfony/form installed).
 * Directories that do not exist are left out (Twig would reject them).
 */
export class TwigLoaderPaths {
  private constructor(
    readonly namespaces: ReadonlyMap<string, readonly string[]>,
    readonly warnings: readonly string[],
  ) {}

  static build(projectRoot: string, parsers: Parsers): TwigLoaderPaths {
    const namespaces = new Map<string, string[]>();
    const add = (dir: string, namespace: string): void => {
      if (isDirectory(dir)) {
        namespaces.set(namespace, [...(namespaces.get(namespace) ?? []), dir]);
      }
    };

    const config = TwigConfig.load(projectRoot, KERNEL_ENV);
    const warnings = [...config.warnings];
    const autoload = ComposerAutoload.load(projectRoot);

    for (const entry of config.paths) {
      add(entry.dir, entry.namespace ?? MAIN_NAMESPACE);
    }

    const bundlesFile = path.join(projectRoot, 'config', 'bundles.php');
    const bundlesSource = readText(bundlesFile);
    for (const className of bundlesSource === null ? [] : enabledBundles(bundlesSource, KERNEL_ENV, parsers)) {
      const name = className.split('\\').pop() ?? className;
      const namespace = name.endsWith('Bundle') ? name.slice(0, -'Bundle'.length) : name;
      const views = bundleViewsDir(className, name, autoload, parsers);
      if (views === undefined) {
        // Unknown location: registering only the override would make `@!Name` and
        // templates living in the bundle resolve wrongly. Leave the namespace unknown.
        warnings.push(`Cannot locate the templates of ${className}`);
        continue;
      }

      const dirs: string[] = [];
      if (config.defaultPath !== null) {
        const override = path.join(config.defaultPath, 'bundles', name);
        if (isDirectory(override)) {
          dirs.push(override);
        }
      }
      if (views !== null) {
        dirs.push(views);
      }

      dirs.forEach((dir) => add(dir, namespace));
      const last = dirs[dirs.length - 1];
      if (last !== undefined) {
        add(last, `!${namespace}`);
      }
    }

    if (config.defaultPath !== null) {
      add(config.defaultPath, MAIN_NAMESPACE);
    }

    const bridge = autoload.packageDir('symfony/twig-bridge');
    if (bridge !== null) {
      const views = path.join(bridge, 'Resources', 'views');
      if (autoload.packageDir('symfony/mailer') !== null) {
        add(path.join(views, 'Email'), 'email');
        add(path.join(views, 'Email'), '!email');
      }
      if (autoload.packageDir('symfony/form') !== null) {
        add(path.join(views, 'Form'), MAIN_NAMESPACE);
      }
    }

    return new TwigLoaderPaths(namespaces, warnings);
  }
}

/**
 * The bundle's views directory: null if it has none, undefined if its location
 * cannot be determined (class not found, unsupported getPath()).
 */
function bundleViewsDir(
  className: string,
  shortName: string,
  autoload: ComposerAutoload,
  parsers: Parsers,
): string | null | undefined {
  const classFile = autoload.findClassFile(className);
  const source = classFile === null ? null : readText(classFile);
  const root = classFile === null || source === null ? null : bundleRootDir(source, classFile, shortName, parsers);
  if (root === null) {
    return undefined;
  }
  for (const candidate of [path.join(root, 'Resources', 'views'), path.join(root, 'templates')]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
