import { CompletionItemKind, MarkupKind, Range, TextEdit, type CompletionItem, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { displayPath } from '../../routing/routePath';
import type { RouteInfo } from '../../routing/types';
import type { RouteReference } from './RouteReferenceFinder';

/** Route names for a cursor inside the quotes of a route name literal; replaces the whole literal content. */
export function provideRouteNameCompletion(
  document: TextDocument,
  position: Position,
  references: readonly RouteReference[],
  routes: readonly RouteInfo[],
): CompletionItem[] | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset > candidate.start && offset < candidate.end);
  if (reference === undefined) {
    return null;
  }
  const range = Range.create(document.positionAt(reference.start + 1), document.positionAt(reference.end - 1));
  return routes.map((route) => ({
    label: route.name,
    kind: CompletionItemKind.Reference,
    detail: route.path === null ? undefined : displayPath(route.path),
    documentation: route.controller ? { kind: MarkupKind.Markdown, value: `\`${route.controller}\`` } : undefined,
    sortText: `${route.name.startsWith('_') ? '1' : '0'}${route.name}`,
    filterText: route.name,
    textEdit: TextEdit.replace(range, route.name),
  }));
}
