import { Range, type CompletionItem, type Location, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { DoctrineEntities, EntityField, OpenText } from '../../doctrine/DoctrineEntities';
import { entityFieldItem } from './formFieldCompletion';
import type { CriteriaKeyReference, RepositorySource } from './RepositoryCriteriaFinder';

/** Associations Doctrine accepts in findBy() criteria and orderBy: the to-one side holds the column. */
const TO_ONE_MAPPINGS = ['ManyToOne', 'OneToOne'];

/**
 * Field names for a cursor inside the quotes of a criteria / orderBy key: columns, to-one
 * associations and the columns of embedded objects (`warehouse.city`). Replaces the whole key.
 */
export function provideCriteriaCompletion(
  document: TextDocument,
  position: Position,
  references: readonly CriteriaKeyReference[],
  doctrine: DoctrineEntities,
  openText?: OpenText,
): CompletionItem[] | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset > candidate.start && offset < candidate.end);
  const entity = reference ? entityOf(reference.source, doctrine, openText) : null;
  const fields = entity === null ? null : doctrine.fields(entity, openText);
  if (!reference || !fields) {
    return null;
  }
  const range = Range.create(document.positionAt(reference.start + 1), document.positionAt(reference.end - 1));
  return criteriaFields(fields, doctrine, openText).map((field) => entityFieldItem(field, range));
}

/** The mapped property named by a criteria / orderBy key (`warehouse.city` goes to the embedded column). */
export function provideCriteriaDefinition(
  document: TextDocument,
  position: Position,
  references: readonly CriteriaKeyReference[],
  doctrine: DoctrineEntities,
  openText?: OpenText,
): Location | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset >= candidate.start && offset < candidate.end);
  let className = reference ? entityOf(reference.source, doctrine, openText) : null;
  const segments = reference?.key.split('.') ?? [];
  for (const [index, segment] of segments.entries()) {
    const field = className === null ? undefined : doctrine.fields(className, openText)?.find((candidate) => candidate.name === segment);
    if (!field) {
      return null;
    }
    if (index === segments.length - 1) {
      return field.location;
    }
    className = field.kind === 'embedded' ? field.target : null;
  }
  return null;
}

function entityOf(source: RepositorySource, doctrine: DoctrineEntities, openText: OpenText | undefined): string | null {
  return source.kind === 'entity' ? source.className : doctrine.entityOfRepository(source.repositoryClass, openText);
}

/** Columns, to-one associations, and embedded columns flattened as `embedded.column`. */
function criteriaFields(fields: readonly EntityField[], doctrine: DoctrineEntities, openText: OpenText | undefined): EntityField[] {
  return fields.flatMap((field) => {
    if (field.kind === 'field' || (field.kind === 'association' && TO_ONE_MAPPINGS.includes(field.mapping))) {
      return [field];
    }
    if (field.kind === 'embedded' && field.target !== null) {
      const columns = doctrine.fields(field.target, openText) ?? [];
      return columns.filter((column) => column.kind === 'field').map((column) => ({ ...column, name: `${field.name}.${column.name}` }));
    }
    return [];
  });
}
