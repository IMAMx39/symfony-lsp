import { CompletionItemKind, Range, TextEdit, type CompletionItem, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { DoctrineEntities, EntityField, OpenText } from '../../doctrine/DoctrineEntities';
import type { FormFieldReference } from './FormFieldReferenceFinder';

/**
 * Mapped fields of the form's `data_class` entity for a cursor inside the quotes of an
 * `->add('...')` child name; replaces the whole literal content. Nothing when `data_class` is
 * unknown or not a mapped class.
 */
export function provideFormFieldCompletion(
  document: TextDocument,
  position: Position,
  references: readonly FormFieldReference[],
  doctrine: DoctrineEntities,
  openText?: OpenText,
): CompletionItem[] | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset > candidate.start && offset < candidate.end);
  const fields = reference?.dataClass ? doctrine.fields(reference.dataClass, openText) : null;
  if (!reference || !fields) {
    return null;
  }
  const range = Range.create(document.positionAt(reference.start + 1), document.positionAt(reference.end - 1));
  return fields.map((field) => entityFieldItem(field, range));
}

/** Completion item of an entity field, replacing `range`. Shared with the QueryBuilder completion. */
export function entityFieldItem(field: EntityField, range: Range): CompletionItem {
  return {
    label: field.name,
    kind: field.kind === 'field' ? CompletionItemKind.Field : CompletionItemKind.Reference,
    detail: fieldDetail(field),
    filterText: field.name,
    textEdit: TextEdit.replace(range, field.name),
  };
}

function fieldDetail(field: EntityField): string {
  if (field.target !== null) {
    return `${field.mapping} → ${field.target}`;
  }
  return field.phpType === null ? field.mapping : `${field.mapping} ${field.phpType}`;
}
