import { Location, Range, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { TemplateResolver } from '../../project/TemplateResolver';
import { pathToUri } from '../../util/paths';
import type { TemplateReference } from './TemplateReferenceFinder';

export function findReferenceAt(
  references: readonly TemplateReference[],
  offset: number,
): TemplateReference | undefined {
  return references.find((reference) => offset >= reference.start && offset < reference.end);
}

export function provideTemplateDefinition(
  document: TextDocument,
  position: Position,
  references: readonly TemplateReference[],
  resolver: TemplateResolver,
): Location | null {
  const reference = findReferenceAt(references, document.offsetAt(position));
  if (reference === undefined) {
    return null;
  }
  const file = resolver.resolve(reference.name);
  return file === null ? null : Location.create(pathToUri(file), Range.create(0, 0, 0, 0));
}
