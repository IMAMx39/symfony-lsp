import * as fs from 'node:fs';
import * as path from 'node:path';

interface Psr4Entry {
  prefix: string;
  dirs: string[];
}

/**
 * PSR-4 class lookup and package directories, read from the project's composer.json
 * and vendor/composer/installed.json (never from PHP: no autoloader is executed).
 */
export class ComposerAutoload {
  private constructor(
    private readonly psr4: readonly Psr4Entry[],
    private readonly packages: ReadonlyMap<string, string>,
  ) {}

  static load(projectRoot: string): ComposerAutoload {
    const psr4: Psr4Entry[] = [];
    const packages = new Map<string, string>();

    const rootManifest = readJson(path.join(projectRoot, 'composer.json'));
    psr4.push(...psr4Entries(rootManifest, projectRoot));

    const composerDir = path.join(projectRoot, 'vendor', 'composer');
    const installed = readJson(path.join(composerDir, 'installed.json'));
    // Composer 2: { packages: [...] }, Composer 1: [...]
    const list = isRecord(installed) ? installed['packages'] : installed;
    for (const pkg of Array.isArray(list) ? list : []) {
      if (!isRecord(pkg) || typeof pkg['name'] !== 'string') {
        continue;
      }
      const installPath = pkg['install-path'];
      const dir =
        typeof installPath === 'string'
          ? path.resolve(composerDir, installPath)
          : path.join(projectRoot, 'vendor', ...pkg['name'].split('/'));
      packages.set(pkg['name'], dir);
      psr4.push(...psr4Entries(pkg, dir));
    }

    // Longest prefix first, as Composer does.
    psr4.sort((a, b) => b.prefix.length - a.prefix.length);
    return new ComposerAutoload(psr4, packages);
  }

  /** File declaring a fully qualified class name, if it exists. */
  findClassFile(className: string): string | null {
    const fqcn = className.replace(/^\\/, '');
    for (const entry of this.psr4) {
      if (!fqcn.startsWith(entry.prefix)) {
        continue;
      }
      const relative = fqcn.slice(entry.prefix.length).split('\\');
      const last = relative.pop();
      if (last === undefined || last === '') {
        continue;
      }
      for (const dir of entry.dirs) {
        const file = path.join(dir, ...relative, `${last}.php`);
        if (isFile(file)) {
          return file;
        }
      }
    }
    return null;
  }

  packageDir(name: string): string | null {
    return this.packages.get(name) ?? null;
  }
}

function psr4Entries(manifest: unknown, baseDir: string): Psr4Entry[] {
  const autoload = isRecord(manifest) ? manifest['autoload'] : undefined;
  const psr4 = isRecord(autoload) ? autoload['psr-4'] : undefined;
  if (!isRecord(psr4)) {
    return [];
  }
  return Object.entries(psr4).map(([prefix, dirs]) => ({
    prefix,
    dirs: (Array.isArray(dirs) ? dirs : [dirs])
      .filter((dir): dir is string => typeof dir === 'string')
      .map((dir) => path.resolve(baseDir, dir)),
  }));
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
