import { Query, type Node } from 'web-tree-sitter';
import type { Parsers } from '../../parsing/parsers';
import phpTemplatesQuery from '../../parsing/queries/php-templates.scm?raw';

/** A literal template name in a document. Offsets cover the literal including its quotes. */
export interface TemplateReference {
  name: string;
  start: number;
  end: number;
}

export class TemplateReferenceFinder {
  private readonly phpQuery: Query;

  constructor(parsers: Parsers) {
    this.phpQuery = new Query(parsers.php, phpTemplatesQuery);
  }

  findInPhp(root: Node): TemplateReference[] {
    const references: TemplateReference[] = [];
    for (const match of this.phpQuery.matches(root)) {
      const template = match.captures.find((capture) => capture.name === 'template')?.node;
      const attribute = match.captures.find((capture) => capture.name === 'attribute')?.node;
      if (template === undefined) {
        continue;
      }
      if (attribute !== undefined && lastNameSegment(attribute.text) !== 'Template') {
        continue;
      }
      const name = phpStringLiteralValue(template);
      if (name !== null) {
        references.push({ name, start: template.startIndex, end: template.endIndex });
      }
    }
    return references;
  }
}

/**
 * Value of a PHP string literal, or null when it is not a plain literal:
 * interpolation, escape sequences or syntax errors make the value uncertain.
 */
export function phpStringLiteralValue(node: Node): string | null {
  if (node.hasError) {
    return null;
  }
  const text = node.text;
  const quote = node.type === 'string' ? "'" : node.type === 'encapsed_string' ? '"' : null;
  if (quote === null || text.length < 2 || !text.startsWith(quote) || !text.endsWith(quote)) {
    return null;
  }
  if (node.type === 'encapsed_string' && node.namedChildren.some((child) => child?.type !== 'string_content')) {
    return null;
  }
  const value = text.slice(1, -1);
  return value.includes('\\') ? null : value;
}

function lastNameSegment(qualifiedName: string): string {
  const parts = qualifiedName.split('\\');
  return parts[parts.length - 1] ?? '';
}
