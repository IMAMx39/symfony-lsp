import * as path from 'node:path';
import { CompletionItemKind, Range, TextEdit, type CompletionItem, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { IndexedTemplate } from '../../index/TemplateIndex';
import { MAIN_NAMESPACE } from '../../project/TwigLoaderPaths';
import { isInsidePath } from '../../util/paths';
import type { TemplateReference } from './TemplateReferenceFinder';

/**
 * Template names for a cursor inside the quotes of a template literal. The whole literal
 * content is replaced, so completing in the middle of an existing name works.
 * `@!Namespace/` names are only offered once the user typed `@!`.
 */
export function provideTemplateCompletion(
  document: TextDocument,
  position: Position,
  references: readonly TemplateReference[],
  templates: readonly IndexedTemplate[],
  projectRoot: string,
): CompletionItem[] | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset > candidate.start && offset < candidate.end);
  if (reference === undefined) {
    return null;
  }
  const contentStart = reference.start + 1;
  const contentEnd = reference.end - 1;
  const typed = document.getText().slice(contentStart, offset);
  const wantsOriginalBundleTemplates = typed.startsWith('@!');
  const range = Range.create(document.positionAt(contentStart), document.positionAt(contentEnd));

  return templates
    .filter((template) => template.namespace.startsWith('!') === wantsOriginalBundleTemplates)
    .map((template) => ({
      label: template.name,
      kind: CompletionItemKind.File,
      detail: displayPath(template.file, projectRoot),
      sortText: `${template.namespace === MAIN_NAMESPACE ? '0' : '1'}${template.name}`,
      filterText: template.name,
      textEdit: TextEdit.replace(range, template.name),
    }));
}

function displayPath(file: string, projectRoot: string): string {
  return isInsidePath(file, projectRoot) ? path.relative(projectRoot, file).split(path.sep).join('/') : file;
}
