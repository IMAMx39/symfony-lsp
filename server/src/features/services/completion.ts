import { CompletionItemKind, Range, TextEdit, type CompletionItem, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ServiceReference } from '../../services/yamlServices';
import type { ServiceInfo } from '../../services/types';

/**
 * Service ids for a cursor inside a `'@...'` reference, after its `@` / `@?` / `@!` prefix.
 * Replaces the whole id, keeping the prefix and the quotes.
 */
export function provideServiceCompletion(
  document: TextDocument,
  position: Position,
  references: readonly ServiceReference[],
  services: readonly ServiceInfo[],
): CompletionItem[] | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset >= candidate.idStart && offset <= candidate.idEnd);
  if (reference === undefined) {
    return null;
  }
  const range = Range.create(document.positionAt(reference.idStart), document.positionAt(reference.idEnd));
  return services.map((service) => ({
    label: service.id,
    kind: service.alias === null ? CompletionItemKind.Class : CompletionItemKind.Reference,
    detail: service.alias === null ? (service.class ?? undefined) : `alias of ${service.alias}`,
    filterText: service.id,
    textEdit: TextEdit.replace(range, service.id),
  }));
}
