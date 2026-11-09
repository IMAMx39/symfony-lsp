import * as fs from 'node:fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Node } from 'web-tree-sitter';
import type { Parsers } from '../parsing/parsers';
import { fileNamespace } from '../parsing/phpNames';
import { pathToUri } from '../util/paths';
import type { ComposerAutoload } from './ComposerAutoload';

/** Content of a file: an open document when there is one, else null to read the disk. */
export type OpenText = (file: string) => string | null;

/** A class-like declaration found through PSR-4, with the tree of its file. */
export interface ParsedClass {
  file: string;
  root: Node;
  declaration: Node;
  uri: string;
  text: TextDocument;
}

/**
 * Parses the file PSR-4 gives for a fully qualified name (open document first) and hands the
 * declaration of that name to `read`. Null when the file is missing or does not declare it, as
 * one of `kinds`, in the expected namespace. The tree only lives during `read`.
 */
export function withClassDeclaration<T>(
  autoload: ComposerAutoload,
  parsers: Parsers,
  className: string,
  openText: OpenText,
  kinds: string | string[],
  read: (parsed: ParsedClass) => T,
): T | null {
  const fqcn = className.replace(/^\\/, '');
  const file = autoload.findClassFile(fqcn);
  const source = file === null ? null : (openText(file) ?? readText(file));
  const tree = file === null || source === null ? null : parsers.parse('php', source);
  if (file === null || source === null || tree === null) {
    return null;
  }
  try {
    const root = tree.rootNode;
    const shortName = fqcn.split('\\').pop();
    const declaration = root.descendantsOfType(kinds).find((node) => node?.childForFieldName('name')?.text === shortName);
    if (!declaration || (fileNamespace(root) ?? '') !== fqcn.split('\\').slice(0, -1).join('\\')) {
      return null;
    }
    const uri = pathToUri(file);
    return read({ file, root, declaration, uri, text: TextDocument.create(uri, 'php', 0, source) });
  } finally {
    tree.delete();
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
