import type { Location, Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { DoctrineEntities, OpenText } from '../../doctrine/DoctrineEntities';
import { dqlPathAt, resolveAlias, resolveDqlField } from './dqlPaths';
import type { QueryBuilderReference } from './QueryBuilderReferenceFinder';
import type { RepositoryReference } from './RepositoryReferenceFinder';

/** The repository class declared by the entity given to `->getRepository()`. */
export function provideRepositoryDefinition(
  document: TextDocument,
  position: Position,
  references: readonly RepositoryReference[],
  resolver: DoctrineEntities,
  openText?: OpenText,
): Location | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset >= candidate.start && offset < candidate.end);
  return reference ? resolver.repositoryLocation(reference.entityClass, openText) : null;
}

/**
 * In a DQL string of a QueryBuilder call: the mapped property for a field of `alias.field`
 * (embedded objects followed), the entity class for an alias. Nothing for an unknown alias.
 */
export function provideQueryBuilderDefinition(
  document: TextDocument,
  position: Position,
  references: readonly QueryBuilderReference[],
  doctrine: DoctrineEntities,
  openText?: OpenText,
): Location | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset > candidate.start && offset < candidate.end);
  if (!reference) {
    return null;
  }
  const content = document.getText().slice(reference.start + 1, reference.end - 1);
  const found = dqlPathAt(content, reference.start + 1, offset);
  if (!found) {
    return null;
  }
  const { path, index } = found;
  if (index === 0) {
    const alias = path.segments[0];
    const className = alias ? resolveAlias(alias.name, reference.aliases, doctrine, openText) : null;
    return className === null ? null : doctrine.classLocation(className);
  }
  return resolveDqlField(path, index, reference.aliases, doctrine, openText)?.location ?? null;
}
