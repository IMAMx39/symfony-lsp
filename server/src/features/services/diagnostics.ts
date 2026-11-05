import { DiagnosticSeverity, Range, type Diagnostic } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ServiceIndex } from '../../index/ServiceIndex';
import type { ServiceReference } from '../../services/yamlServices';
import { DIAGNOSTIC_SOURCE } from '../templates/diagnostics';

export const SERVICE_NOT_FOUND = 'service-not-found';

/**
 * "Service not found" warnings, only when every service of the project is known
 * (ServiceIndex.isCertain) and the reference requires the service: `@?id`, `@!id` and nullable
 * autowired parameters tolerate a missing one, and a namespaced id whose class exists may be
 * registered by a `resource:` prototype since the last dump.
 */
export function provideServiceDiagnostics(
  document: TextDocument,
  references: readonly ServiceReference[],
  index: ServiceIndex,
): Diagnostic[] {
  const missing = references.filter(
    (reference) => !reference.optional && reference.id !== '' && index.get(reference.id) === undefined && !index.mayBeAutoregistered(reference.id),
  );
  if (missing.length === 0 || !index.isCertain()) {
    return [];
  }
  return missing.map((reference) => ({
    range: Range.create(document.positionAt(reference.start), document.positionAt(reference.end)),
    severity: DiagnosticSeverity.Warning,
    source: DIAGNOSTIC_SOURCE,
    code: SERVICE_NOT_FOUND,
    message: `Service "${reference.id}" not found.`,
  }));
}
