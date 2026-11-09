import * as fs from 'node:fs';
import * as path from 'node:path';

const IGNORED_DIRS = new Set(['vendor', 'var', 'node_modules', 'public', '.git']);

/** `.php` files under a directory, recursively (dependency, cache and build directories skipped), sorted. */
export function phpFiles(dir: string): string[] {
  const files: string[] = [];
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
        pending.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.php')) {
        files.push(full);
      }
    }
  }
  return files.sort();
}
