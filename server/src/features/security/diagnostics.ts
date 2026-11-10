import { DiagnosticSeverity, Range, type Diagnostic } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ServiceIndex } from '../../index/ServiceIndex';
import type { SecurityConfig } from '../../project/SecurityConfig';
import type { SecurityReferences } from '../../security/securityYaml';
import { provideServiceDiagnostics } from '../services/diagnostics';
import { DIAGNOSTIC_SOURCE } from '../templates/diagnostics';

export const PROVIDER_NOT_FOUND = 'security-provider-not-found';

/**
 * "User provider not found" warnings (SecurityExtension throws on them), only when every
 * provider is known (SecurityConfig.isCertain), plus "service not found" ones for the service ids
 * of the security configuration (same conditions as in services YAML).
 */
export function provideSecurityDiagnostics(
  document: TextDocument,
  references: SecurityReferences,
  config: SecurityConfig,
  services: ServiceIndex,
): Diagnostic[] {
  const missing = references.providers.filter((reference) => reference.name !== '' && config.findProvider(reference.name) === undefined);
  const providers =
    missing.length === 0 || !config.isCertain()
      ? []
      : missing.map((reference) => ({
          range: Range.create(document.positionAt(reference.start), document.positionAt(reference.end)),
          severity: DiagnosticSeverity.Warning,
          source: DIAGNOSTIC_SOURCE,
          code: PROVIDER_NOT_FOUND,
          message: `User provider "${reference.name}" not found.`,
        }));
  return [...providers, ...provideServiceDiagnostics(document, references.services, services)];
}
