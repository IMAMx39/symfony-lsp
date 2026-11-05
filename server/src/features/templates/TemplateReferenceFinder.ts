import { Query, type Node } from 'web-tree-sitter';
import { phpStringLiteralValue, twigStringLiteralValue } from '../../parsing/literals';
import type { DocumentLanguage, Parsers } from '../../parsing/parsers';
import phpTemplatesQuery from '../../parsing/queries/php-templates.scm?raw';
import twigTemplatesQuery from '../../parsing/queries/twig-templates.scm?raw';

/** A literal template name in a document. Offsets cover the literal including its quotes. */
export interface TemplateReference {
  name: string;
  start: number;
  end: number;
}

export class TemplateReferenceFinder {
  private readonly phpQuery: Query;
  private readonly twigQuery: Query;

  constructor(parsers: Parsers) {
    this.phpQuery = new Query(parsers.php, phpTemplatesQuery);
    this.twigQuery = new Query(parsers.twig, twigTemplatesQuery);
  }

  find(language: DocumentLanguage, root: Node): TemplateReference[] {
    return language === 'php' ? this.findInPhp(root) : this.findInTwig(root);
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

  findInTwig(root: Node): TemplateReference[] {
    const references: TemplateReference[] = [];
    for (const match of this.twigQuery.matches(root)) {
      const expression = match.captures.find((capture) => capture.name === 'template')?.node;
      if (expression === undefined) {
        continue;
      }
      for (const literal of twigLiteralCandidates(expression)) {
        const name = twigStringLiteralValue(literal);
        if (name !== null) {
          references.push({ name, start: literal.startIndex, end: literal.endIndex });
        }
      }
    }
    return references;
  }
}

/** String nodes an expression may evaluate to: itself, array items, ternary branches. */
function twigLiteralCandidates(expression: Node): Node[] {
  switch (expression.type) {
    case 'string':
      return [expression];
    case 'array':
      return expression.namedChildren.filter((child): child is Node => child?.type === 'string');
    case 'ternary_expression':
      return ['consequence', 'alternative'].flatMap((field) => {
        const branch = expression.childForFieldName(field);
        return branch === null ? [] : twigLiteralCandidates(branch);
      });
    default:
      return [];
  }
}

function lastNameSegment(qualifiedName: string): string {
  const parts = qualifiedName.split('\\');
  return parts[parts.length - 1] ?? '';
}
