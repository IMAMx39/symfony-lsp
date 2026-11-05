import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { parseTemplateName, type TemplateResolver } from '../../project/TemplateResolver';
import type { TemplateReference } from './TemplateReferenceFinder';

export const DIAGNOSTIC_SOURCE = 'symfony';
export const TEMPLATE_NOT_FOUND = 'template-not-found';

/**
 * "Template not found" warnings. Reported only when certain:
 * - every alternative of the group is a plain literal ending with `.twig`;
 * - Twig does not tolerate the absence (`ignore missing`);
 * - the namespace's directories are known exactly (`isCertain`);
 * - and none of the alternatives resolves.
 */
export function provideTemplateDiagnostics(
  document: TextDocument,
  references: readonly TemplateReference[],
  resolver: TemplateResolver,
  isCertain: (namespace: string) => boolean,
): Diagnostic[] {
  const groups = new Map<number, TemplateReference[]>();
  for (const reference of references) {
    groups.set(reference.group, [...(groups.get(reference.group) ?? []), reference]);
  }

  const diagnostics: Diagnostic[] = [];
  for (const group of groups.values()) {
    const checkable = group.every((reference) => {
      const parsed = parseTemplateName(reference.name);
      return !reference.missingAllowed && reference.name.endsWith('.twig') && parsed !== null && isCertain(parsed.namespace);
    });
    if (!checkable || group.some((reference) => resolver.resolve(reference.name) !== null)) {
      continue;
    }
    for (const reference of group) {
      diagnostics.push({
        range: Range.create(document.positionAt(reference.start), document.positionAt(reference.end)),
        severity: DiagnosticSeverity.Warning,
        source: DIAGNOSTIC_SOURCE,
        code: TEMPLATE_NOT_FOUND,
        message:
          group.length > 1
            ? `None of the templates ${group.map((item) => `"${item.name}"`).join(', ')} exists.`
            : `Template "${reference.name}" not found.`,
      });
    }
  }
  return diagnostics;
}
