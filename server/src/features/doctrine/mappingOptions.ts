import { Range, type CompletionItem, type Location, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { DoctrineEntities, EntityField, OpenText } from '../../doctrine/DoctrineEntities';
import { entityFieldItem } from './formFieldCompletion';
import type { MappingReference } from './MappingReferenceFinder';

/**
 * Properties of the target entity for a cursor inside the quotes of `mappedBy` / `inversedBy`
 * (its associations) or `indexBy` (its columns). Replaces the whole literal content.
 */
export function provideMappingCompletion(
  document: TextDocument,
  position: Position,
  references: readonly MappingReference[],
  doctrine: DoctrineEntities,
  openText?: OpenText,
): CompletionItem[] | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset > candidate.start && offset < candidate.end);
  const fields = reference ? doctrine.fields(reference.targetEntity, openText) : null;
  if (!reference || !fields) {
    return null;
  }
  const range = Range.create(document.positionAt(reference.start + 1), document.positionAt(reference.end - 1));
  return fields.filter((field) => accepts(reference, field)).map((field) => entityFieldItem(field, range));
}

/** The property of the target entity named by `mappedBy` / `inversedBy` / `indexBy`. */
export function provideMappingDefinition(
  document: TextDocument,
  position: Position,
  references: readonly MappingReference[],
  doctrine: DoctrineEntities,
  openText?: OpenText,
): Location | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset >= candidate.start && offset < candidate.end);
  const field = reference && doctrine.fields(reference.targetEntity, openText)?.find((candidate) => candidate.name === reference.name);
  return field?.location ?? null;
}

function accepts(reference: MappingReference, field: EntityField): boolean {
  return reference.option === 'indexBy' ? field.kind === 'field' : field.kind === 'association';
}
