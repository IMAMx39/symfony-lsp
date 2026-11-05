import * as path from 'node:path';
import { URI } from 'vscode-uri';

const isWindows = process.platform === 'win32';

export function uriToPath(uri: string): string {
  return URI.parse(uri).fsPath;
}

export function pathToUri(fsPath: string): string {
  return URI.file(fsPath).toString();
}

/**
 * Compares two filesystem paths after resolution.
 * Case-insensitive on Windows, case-sensitive elsewhere.
 */
export function isSamePath(a: string, b: string): boolean {
  return comparable(a) === comparable(b);
}

/** True if `child` is `parent` or lies inside it (same case rules as isSamePath). */
export function isInsidePath(child: string, parent: string): boolean {
  const relative = path.relative(comparable(parent), comparable(child));
  return relative === '' || (relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative));
}

/** Key identifying a file in maps: resolved, and lower-cased on Windows. */
export function pathKey(fsPath: string): string {
  return comparable(fsPath);
}

function comparable(fsPath: string): string {
  const resolved = path.resolve(fsPath);
  return isWindows ? resolved.toLowerCase() : resolved;
}

/** Path shown to the user: relative to the project (with `/`) when inside it, else absolute. */
export function displayFilePath(file: string, projectRoot: string): string {
  return isInsidePath(file, projectRoot) ? path.relative(projectRoot, file).split(path.sep).join('/') : file;
}
