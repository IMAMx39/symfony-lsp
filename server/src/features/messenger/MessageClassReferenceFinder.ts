import { Query, type Node } from 'web-tree-sitter';
import { declaredClassName } from '../../messenger/messageHandlers';
import type { Parsers } from '../../parsing/parsers';
import { resolveClassName } from '../../parsing/phpNames';
import messageClassesQuery from '../../parsing/queries/php-message-classes.scm?raw';

/** A class name in PHP code, resolved. Offsets cover the name as written. */
export interface ClassNameReference {
  className: string;
  start: number;
  end: number;
}

/**
 * Class names that may designate a message: class and interface declarations, `new X()`,
 * `X::class` and type hints, resolved through the namespace and `use` imports of the file.
 */
export class MessageClassReferenceFinder {
  private readonly query: Query;

  constructor(parsers: Parsers) {
    this.query = new Query(parsers.php, messageClassesQuery);
  }

  find(root: Node): ClassNameReference[] {
    const references: ClassNameReference[] = [];
    for (const match of this.query.matches(root)) {
      const declared = match.captures.find((capture) => capture.name === 'declared')?.node;
      const used = match.captures.find((capture) => capture.name === 'class')?.node;
      const declaration = declared?.parent;
      const className = declared && declaration ? declaredClassName(declaration, root) : used ? resolveClassName(used.text, root) : null;
      const node = declared ?? used;
      if (node && className !== null) {
        references.push({ className, start: node.startIndex, end: node.endIndex });
      }
    }
    return references;
  }
}
