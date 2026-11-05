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
  /** References sharing a group are alternatives (`['a', 'b']`): Twig loads the first existing one. */
  group: number;
  /** Twig tolerates a missing template here (`ignore missing`, non-literal alternatives). */
  missingAllowed: boolean;
}

/** Literals among which Twig needs at least one existing template. */
interface AlternativeSet {
  literals: Node[];
  /** False when some alternative is not a plain literal (its value is unknown). */
  complete: boolean;
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
      const template = capture(match.captures, 'template');
      const attribute = capture(match.captures, 'attribute');
      if (template === undefined) {
        continue;
      }
      if (attribute !== undefined && lastNameSegment(attribute.text) !== 'Template') {
        continue;
      }
      const name = phpStringLiteralValue(template);
      if (name !== null) {
        references.push({
          name,
          start: template.startIndex,
          end: template.endIndex,
          group: references.length,
          missingAllowed: false,
        });
      }
    }
    return references;
  }

  findInTwig(root: Node): TemplateReference[] {
    const references: TemplateReference[] = [];
    let group = 0;
    for (const match of this.twigQuery.matches(root)) {
      const expression = capture(match.captures, 'template');
      if (expression === undefined) {
        continue;
      }
      const fn = capture(match.captures, 'function');
      const ignoresMissing = fn === undefined ? tagIgnoresMissing(expression) : callIgnoresMissing(fn);

      for (const set of alternativeSets(expression)) {
        group++;
        for (const literal of set.literals) {
          const name = twigStringLiteralValue(literal);
          if (name !== null) {
            references.push({
              name,
              start: literal.startIndex,
              end: literal.endIndex,
              group,
              missingAllowed: ignoresMissing || !set.complete,
            });
          }
        }
      }
    }
    return references;
  }
}

/**
 * Alternative sets of a template expression: a string or an array is one set (Twig loads
 * the first existing item); each branch of a ternary is its own set (either may be used).
 */
function alternativeSets(expression: Node): AlternativeSet[] {
  switch (expression.type) {
    case 'string':
      return [{ literals: [expression], complete: twigStringLiteralValue(expression) !== null }];
    case 'array': {
      const items = expression.namedChildren.filter((child): child is Node => child !== null);
      const literals = items.filter((item) => item.type === 'string');
      const complete = literals.length === items.length && literals.every((item) => twigStringLiteralValue(item) !== null);
      return [{ literals, complete }];
    }
    case 'ternary_expression':
      return ['consequence', 'alternative'].flatMap((field) => {
        const branch = expression.childForFieldName(field);
        return branch === null ? [] : alternativeSets(branch);
      });
    default:
      return [];
  }
}

/** `{% include 'x' ignore missing %}` / `{% embed 'x' ignore missing %}`. */
function tagIgnoresMissing(expression: Node): boolean {
  const tag = expression.parent;
  return tag !== null && tag.children.some((child) => !child?.isNamed && child?.text.replace(/\s+/g, ' ') === 'ignore missing');
}

/**
 * include(template, variables, with_context, ignore_missing, sandboxed) and
 * source(name, ignore_missing): any explicit ignore_missing argument disables the check.
 */
function callIgnoresMissing(fn: Node): boolean {
  const args = fn.parent?.childForFieldName('arguments')?.namedChildren ?? [];
  const position = fn.text === 'include' ? 3 : 1;
  return (
    args.length > position ||
    args.some((arg) => arg?.type === 'named_argument' && arg.childForFieldName('key')?.text === 'ignore_missing')
  );
}

function capture(captures: readonly { name: string; node: Node }[], name: string): Node | undefined {
  return captures.find((item) => item.name === name)?.node;
}

function lastNameSegment(qualifiedName: string): string {
  const parts = qualifiedName.split('\\');
  return parts[parts.length - 1] ?? '';
}
