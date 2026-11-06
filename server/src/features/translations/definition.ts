import type { Location, Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { TranslationIndex } from '../../index/TranslationIndex';
import type { TranslationReference } from './TranslationReferenceFinder';

export function findTranslationReferenceAt(references: readonly TranslationReference[], offset: number): TranslationReference | undefined {
  return references.find((reference) => offset >= reference.start && offset < reference.end);
}

/** The key in every translation file of its domain, the default locale first. */
export function provideTranslationDefinition(
  document: TextDocument,
  position: Position,
  references: readonly TranslationReference[],
  index: TranslationIndex,
): Location[] | null {
  const reference = findTranslationReferenceAt(references, document.offsetAt(position));
  if (!reference || reference.domain === null || reference.key === '') {
    return null;
  }
  const locations = index.entries(reference.domain, reference.key).map((entry) => entry.location);
  return locations.length > 0 ? locations : null;
}
