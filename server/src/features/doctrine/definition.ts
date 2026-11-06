import type { Location, Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { DoctrineEntities, OpenText } from '../../doctrine/DoctrineEntities';
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
