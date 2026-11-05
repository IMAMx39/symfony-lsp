import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Tree } from 'web-tree-sitter';
import { uriToPath } from '../util/paths';
import type { DocumentLanguage, Parsers } from './parsers';

export function languageOf(uri: string): DocumentLanguage | null {
  const file = uriToPath(uri).toLowerCase();
  if (file.endsWith('.php')) {
    return 'php';
  }
  if (file.endsWith('.twig')) {
    return 'twig';
  }
  return null;
}

/**
 * Syntax trees of open documents, reparsed when the document version changes.
 * Trees live in the WASM heap: replaced or closed trees are explicitly deleted.
 */
export class DocumentTrees {
  private readonly cache = new Map<string, { version: number; tree: Tree }>();

  constructor(private readonly parsers: Parsers) {}

  get(document: TextDocument): Tree | null {
    const cached = this.cache.get(document.uri);
    if (cached?.version === document.version) {
      return cached.tree;
    }
    const language = languageOf(document.uri);
    if (language === null) {
      return null;
    }
    cached?.tree.delete();
    this.cache.delete(document.uri);

    const tree = this.parsers.parse(language, document.getText());
    if (tree !== null) {
      this.cache.set(document.uri, { version: document.version, tree });
    }
    return tree;
  }

  delete(uri: string): void {
    this.cache.get(uri)?.tree.delete();
    this.cache.delete(uri);
  }
}
