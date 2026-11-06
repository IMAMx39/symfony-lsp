import { DiagnosticSeverity, Range, type Diagnostic } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { TranslationIndex } from '../../index/TranslationIndex';
import { DIAGNOSTIC_SOURCE } from '../templates/diagnostics';
import type { TranslationReference } from './TranslationReferenceFinder';

export const TRANSLATION_NOT_FOUND = 'translation-not-found';

/**
 * "Translation not found" warnings on literal message ids missing from the default locale,
 * only for a known domain whose default-locale catalogue is entirely known
 * (TranslationIndex.isCertain).
 */
export function provideTranslationDiagnostics(
  document: TextDocument,
  references: readonly TranslationReference[],
  index: TranslationIndex,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const reference of references) {
    const { key, domain } = reference;
    if (domain === null || key === '' || !index.isCertain(domain) || index.hasDefaultTranslation(domain, key)) {
      continue;
    }
    const [start, end] = reference.kind === 'literal' ? [reference.start, reference.end] : [reference.keyStart, reference.keyEnd];
    diagnostics.push({
      range: Range.create(document.positionAt(start), document.positionAt(end)),
      severity: DiagnosticSeverity.Warning,
      source: DIAGNOSTIC_SOURCE,
      code: TRANSLATION_NOT_FOUND,
      message: `Translation "${key}" not found in domain "${domain}" for locale "${index.defaultLocale}".`,
    });
  }
  return diagnostics;
}
