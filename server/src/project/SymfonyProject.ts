import * as fs from 'node:fs';
import * as path from 'node:path';

/** Directories never inspected when looking for a nested Symfony project. */
const IGNORED_DIRS = new Set(['vendor', 'var', 'node_modules', 'public', '.git']);

export class SymfonyProject {
  private constructor(readonly root: string) {}

  /**
   * Detects the Symfony project for a workspace folder.
   *
   * The folder itself is checked first. Otherwise, its direct subdirectories are
   * checked (common Docker layout: `docker/` + `app/`). If several subdirectories
   * match, the result is ambiguous and nothing is returned.
   */
  static detect(workspaceDir: string): SymfonyProject | null {
    const dir = path.resolve(workspaceDir);
    if (isSymfonyRoot(dir)) {
      return new SymfonyProject(dir);
    }

    const candidates = listSubdirectories(dir).filter(isSymfonyRoot);
    const [single] = candidates;
    return candidates.length === 1 && single !== undefined ? new SymfonyProject(single) : null;
  }
}

function isSymfonyRoot(dir: string): boolean {
  return (
    isFile(path.join(dir, 'composer.json')) &&
    (isFile(path.join(dir, 'bin', 'console')) || isFile(path.join(dir, 'config', 'bundles.php')))
  );
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function listSubdirectories(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !IGNORED_DIRS.has(entry.name))
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}
