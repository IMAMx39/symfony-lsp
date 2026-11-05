import * as path from 'node:path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Parsers } from '../src/parsing/parsers';

const serverDir = path.resolve(__dirname, '..');

export const fixtureApp = path.join(serverDir, 'tests', 'fixtures', 'symfony-app');

let parsers: Promise<Parsers> | undefined;

/** Parsers loaded from node_modules (the bundled layout only exists after a build). */
export function loadParsers(): Promise<Parsers> {
  parsers ??= Parsers.load({
    runtime: path.join(serverDir, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
    php: path.join(serverDir, 'node_modules', 'tree-sitter-php', 'tree-sitter-php.wasm'),
    twig: path.join(serverDir, 'node_modules', 'tree-sitter-twig', 'tree-sitter-twig.wasm'),
  });
  return parsers;
}

/**
 * Builds a document from a source containing a single `|` cursor marker.
 * Returns the document (marker removed) and the cursor offset.
 */
export function withCursor(uri: string, languageId: string, source: string): { document: TextDocument; offset: number } {
  const offset = source.indexOf('|');
  if (offset === -1 || source.indexOf('|', offset + 1) !== -1) {
    throw new Error('Source must contain exactly one | cursor marker');
  }
  const text = source.slice(0, offset) + source.slice(offset + 1);
  return { document: TextDocument.create(uri, languageId, 1, text), offset };
}
