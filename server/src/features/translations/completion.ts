import { CompletionItemKind, Range, TextEdit, type CompletionItem, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { TranslationIndex } from '../../index/TranslationIndex';
import type { TranslationReference } from './TranslationReferenceFinder';

/**
 * Keys of the domain for a cursor inside a message id literal (between the quotes) or inside the
 * body of a `{% trans %}` tag; replaces the whole key. Nothing when the domain is unknown.
 */
export function provideTranslationCompletion(
  document: TextDocument,
  position: Position,
  references: readonly TranslationReference[],
  index: TranslationIndex,
): CompletionItem[] | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) =>
    candidate.kind === 'literal'
      ? offset > candidate.start && offset < candidate.end
      : offset >= candidate.start && offset <= candidate.end,
  );
  if (reference === undefined || reference.domain === null) {
    return null;
  }
  const range = Range.create(document.positionAt(reference.keyStart), document.positionAt(reference.keyEnd));
  const writable = writableAt(reference, document.getText().charAt(reference.start));
  return index.keys(reference.domain).filter(({ key }) => writable(key)).map(({ key, value }) => ({
    label: key,
    kind: CompletionItemKind.Text,
    detail: value ?? undefined,
    filterText: key,
    textEdit: TextEdit.replace(range, key),
  }));
}

/**
 * Keys that can be inserted as they are: no escaping inside a literal (quote, backslash,
 * interpolation), no Twig delimiter or `%%` (read back as `%`) inside a tag body.
 */
function writableAt(reference: TranslationReference, quote: string): (key: string) => boolean {
  if (reference.kind === 'tag') {
    return (key) => !/\{[{%#]|%%/.test(key);
  }
  return (key) => !key.includes(quote) && !key.includes('\\') && (quote !== '"' || !/\$|#\{/.test(key));
}
