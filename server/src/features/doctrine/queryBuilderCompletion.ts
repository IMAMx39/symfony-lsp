import { Range, type CompletionItem, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { DoctrineEntities, OpenText } from '../../doctrine/DoctrineEntities';
import { entityFieldItem } from './formFieldCompletion';
import { resolveAlias } from './dqlPaths';
import type { QueryBuilderReference } from './QueryBuilderReferenceFinder';

/**
 * `alias.|` (or `alias.embedded.|`) before the cursor, not part of a longer path, a parameter
 * (`:alias`) or a class name.
 */
const PATH_BEFORE_CURSOR = /(?<![\w.:\\$])([A-Za-z_]\w*)\.((?:[A-Za-z_]\w*\.)*)(\w*)$/;

/**
 * Mapped fields of the entity behind a DQL alias, for a cursor after `alias.` in a string literal
 * of a QueryBuilder call; embedded objects are followed (`p.address.|`). Replaces the field
 * name being typed. Nothing for an unknown or ambiguous alias.
 */
export function provideQueryBuilderCompletion(
  document: TextDocument,
  position: Position,
  references: readonly QueryBuilderReference[],
  doctrine: DoctrineEntities,
  openText?: OpenText,
): CompletionItem[] | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset > candidate.start && offset < candidate.end);
  if (!reference) {
    return null;
  }
  const text = document.getText();
  const match = PATH_BEFORE_CURSOR.exec(text.slice(reference.start + 1, offset));
  const [, alias, embeddedPath, partial] = match ?? [];
  if (alias === undefined || embeddedPath === undefined || partial === undefined) {
    return null;
  }
  let className = resolveAlias(alias, reference.aliases, doctrine, openText);
  for (const segment of embeddedPath.split('.').filter((part) => part !== '')) {
    const embedded = className === null ? undefined : doctrine.fields(className, openText)?.find((field) => field.name === segment);
    className = embedded?.kind === 'embedded' ? embedded.target : null;
  }
  const fields = className === null ? null : doctrine.fields(className, openText);
  if (!fields) {
    return null;
  }
  const following = /^\w*/.exec(text.slice(offset, reference.end - 1))?.[0].length ?? 0;
  const range = Range.create(document.positionAt(offset - partial.length), document.positionAt(offset + following));
  return fields.map((field) => entityFieldItem(field, range));
}
