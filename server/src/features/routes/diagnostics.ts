import { DiagnosticSeverity, Range, type Diagnostic } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { RouteIndex } from '../../index/RouteIndex';
import { DIAGNOSTIC_SOURCE } from '../templates/diagnostics';
import type { RouteReference } from './RouteReferenceFinder';

export const ROUTE_NOT_FOUND = 'route-not-found';

/**
 * "Route not found" warnings on literal route names, only when every route of the project
 * is known (RouteIndex.isCertain: compiled cache present, all sources readable).
 */
export function provideRouteDiagnostics(
  document: TextDocument,
  references: readonly RouteReference[],
  index: RouteIndex,
): Diagnostic[] {
  if (!index.isCertain()) {
    return [];
  }
  return references
    .filter((reference) => reference.name !== '' && index.get(reference.name) === undefined)
    .map((reference) => ({
      range: Range.create(document.positionAt(reference.start), document.positionAt(reference.end)),
      severity: DiagnosticSeverity.Warning,
      source: DIAGNOSTIC_SOURCE,
      code: ROUTE_NOT_FOUND,
      message: `Route "${reference.name}" not found.`,
    }));
}
