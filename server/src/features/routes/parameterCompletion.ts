import { CompletionItemKind, Range, TextEdit, type CompletionItem, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { RouteIndex } from '../../index/RouteIndex';
import { pathVariables } from '../../routing/routePath';
import type { RouteParameterKey, RouteReference } from './RouteReferenceFinder';

/**
 * Path variables of the route, for a cursor at a key position of its parameters
 * (`{...}` in Twig, `[...]` in PHP). Variables already used as keys are not offered.
 * - inside a key being typed: the key is replaced (`sl|` → `slug`, `'sl|'` → `'slug'`);
 * - on an empty key position: `slug: ` (Twig) or `'slug' => ` (PHP) is inserted.
 */
export function provideRouteParameterCompletion(
  document: TextDocument,
  position: Position,
  references: readonly RouteReference[],
  index: RouteIndex,
): CompletionItem[] | null {
  const offset = document.offsetAt(position);
  const reference = references.find(
    (candidate) => candidate.parameters && offset > candidate.parameters.start && offset < candidate.parameters.end,
  );
  const parameters = reference?.parameters;
  const route = reference && index.get(reference.name);
  if (!reference || !parameters || !route?.path) {
    return null;
  }
  if (parameters.values.some((value) => offset >= value.start && offset <= value.end)) {
    return null;
  }
  const key = parameters.keys.find((candidate) => isInKey(candidate, offset));
  if (!key && !isAtKeyPosition(document.getText(), offset, parameters.start)) {
    return null;
  }

  const used = new Set(parameters.keys.filter((candidate) => candidate !== key).map((candidate) => candidate.name));
  return pathVariables(route.path)
    .filter((variable) => !used.has(variable))
    .map((variable, order) => ({
      label: variable,
      kind: CompletionItemKind.Property,
      detail: `${route.name} parameter`,
      sortText: String(order).padStart(3, '0'),
      filterText: variable,
      textEdit: key
        ? TextEdit.replace(keyContentRange(document, key), variable)
        : TextEdit.insert(position, reference.language === 'twig' ? `${variable}: ` : `'${variable}' => `),
    }));
}

/** Inside a quoted key (between its quotes), or anywhere on an identifier key. */
function isInKey(key: RouteParameterKey, offset: number): boolean {
  return key.quoted ? offset > key.start && offset < key.end : offset >= key.start && offset <= key.end;
}

function keyContentRange(document: TextDocument, key: RouteParameterKey): Range {
  const start = key.quoted ? key.start + 1 : key.start;
  const end = key.quoted ? key.end - 1 : key.end;
  return Range.create(document.positionAt(start), document.positionAt(end));
}

/** The previous significant character opens the parameters or separates entries. */
function isAtKeyPosition(text: string, offset: number, containerStart: number): boolean {
  let index = offset - 1;
  while (index >= containerStart && /\s/.test(text[index] ?? '')) {
    index--;
  }
  return index >= containerStart && ['{', '[', ','].includes(text[index] ?? '');
}
