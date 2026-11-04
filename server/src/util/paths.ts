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
  const left = path.resolve(a);
  const right = path.resolve(b);
  return isWindows ? left.toLowerCase() === right.toLowerCase() : left === right;
}
