import { Query, type Node } from 'web-tree-sitter';
import { phpClassNameValue } from '../../doctrine/phpClassNames';
import type { Parsers } from '../../parsing/parsers';
import doctrineQuery from '../../parsing/queries/php-doctrine.scm?raw';

/** The entity class given to `->getRepository()`. Offsets cover the argument expression. */
export interface RepositoryReference {
  entityClass: string;
  start: number;
  end: number;
}

/** `->getRepository(Entity::class)` or `->getRepository('App\Entity\Foo')`, first argument (or `className:`). */
export class RepositoryReferenceFinder {
  private readonly query: Query;

  constructor(parsers: Parsers) {
    this.query = new Query(parsers.php, doctrineQuery);
  }

  find(root: Node): RepositoryReference[] {
    const references: RepositoryReference[] = [];
    for (const match of this.query.matches(root)) {
      const args = match.captures.find((capture) => capture.name === 'arguments')?.node;
      const list = args?.namedChildren.filter((arg): arg is Node => arg?.type === 'argument') ?? [];
      const [first] = list;
      const argumentName = first?.childForFieldName('name')?.text;
      if (!first || (argumentName !== undefined && argumentName !== 'className' && argumentName !== 'persistentObject')) {
        continue;
      }
      const value = first.namedChildren[first.namedChildren.length - 1];
      const entityClass = value ? phpClassNameValue(value, root) : null;
      if (value && entityClass !== null) {
        references.push({ entityClass, start: value.startIndex, end: value.endIndex });
      }
    }
    return references;
  }
}
