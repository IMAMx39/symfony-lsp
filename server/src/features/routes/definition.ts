import type { Location, Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { RouteIndex } from '../../index/RouteIndex';
import type { RouteNameReference } from './RouteReferenceFinder';

export function findRouteReferenceAt<T extends RouteNameReference>(references: readonly T[], offset: number): T | undefined {
  return references.find((reference) => offset >= reference.start && offset < reference.end);
}

/** Route declaration (attribute, YAML key) or, for cache-only routes, the controller method. */
export function provideRouteDefinition(
  document: TextDocument,
  position: Position,
  references: readonly RouteNameReference[],
  index: RouteIndex,
): Location | null {
  const reference = findRouteReferenceAt(references, document.offsetAt(position));
  const route = reference && index.get(reference.name);
  return route ? index.locationOf(route) : null;
}
