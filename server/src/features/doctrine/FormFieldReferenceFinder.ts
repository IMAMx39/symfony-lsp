import { Query, type Node } from 'web-tree-sitter';
import { phpClassNameValue } from '../../doctrine/phpClassNames';
import { phpStringLiteralValue } from '../../parsing/literals';
import type { Parsers } from '../../parsing/parsers';
import formFieldsQuery from '../../parsing/queries/php-form-fields.scm?raw';

/** A literal child name given to `->add()` in a form type. Offsets cover the literal, quotes included. */
export interface FormFieldReference {
  name: string;
  start: number;
  end: number;
  /** `data_class` of the form type, null when it is not a single class literal. */
  dataClass: string | null;
}

/**
 * `->add('field', ...)` calls in the `buildForm()` method of a class, with the `data_class` its
 * `configureOptions()` sets: `$resolver->setDefaults(['data_class' => X::class])` or
 * `$resolver->setDefault('data_class', X::class)`.
 */
export class FormFieldReferenceFinder {
  private readonly query: Query;

  constructor(parsers: Parsers) {
    this.query = new Query(parsers.php, formFieldsQuery);
  }

  find(root: Node): FormFieldReference[] {
    const references: FormFieldReference[] = [];
    const dataClasses = new Map<number, string | null>();
    for (const match of this.query.matches(root)) {
      const argument = match.captures.find((capture) => capture.name === 'argument')?.node;
      const nameArgument = argument?.childForFieldName('name')?.text;
      const literal = argument?.namedChildren[argument.namedChildren.length - 1];
      const name = literal ? phpStringLiteralValue(literal) : null;
      if (!argument || !literal || name === null || (nameArgument !== undefined && nameArgument !== 'child')) {
        continue;
      }
      const method = enclosing(argument, 'method_declaration');
      const declaration = method && enclosing(method, 'class_declaration');
      if (!method || !declaration || method.childForFieldName('name')?.text !== 'buildForm') {
        continue;
      }
      if (!dataClasses.has(declaration.startIndex)) {
        dataClasses.set(declaration.startIndex, dataClassOf(declaration, root));
      }
      references.push({ name, start: literal.startIndex, end: literal.endIndex, dataClass: dataClasses.get(declaration.startIndex) ?? null });
    }
    return references;
  }
}

/** The single `data_class` set in `configureOptions()`; null when absent, dynamic or set to several values. */
function dataClassOf(declaration: Node, root: Node): string | null {
  const method = declaration
    .childForFieldName('body')
    ?.namedChildren.find((member) => member?.type === 'method_declaration' && member.childForFieldName('name')?.text === 'configureOptions');
  const values = new Set<string | null>();
  for (const call of method?.descendantsOfType('member_call_expression') ?? []) {
    const methodName = call?.childForFieldName('name')?.text;
    const args = call?.childForFieldName('arguments')?.namedChildren.filter((arg): arg is Node => arg?.type === 'argument') ?? [];
    const [first, second] = args.map((arg) => arg.namedChildren[arg.namedChildren.length - 1]);
    if (methodName === 'setDefault' && first && phpStringLiteralValue(first) === 'data_class') {
      values.add(second ? phpClassNameValue(second, root) : null);
    } else if (methodName === 'setDefaults' && first?.type === 'array_creation_expression') {
      for (const element of first.namedChildren) {
        const [key, value] = element?.type === 'array_element_initializer' ? element.namedChildren : [];
        if (key && value && phpStringLiteralValue(key) === 'data_class') {
          values.add(phpClassNameValue(value, root));
        }
      }
    }
  }
  const [only] = values;
  return values.size === 1 && only !== undefined ? only : null;
}

function enclosing(node: Node, type: string): Node | null {
  for (let current = node.parent; current !== null; current = current.parent) {
    if (current.type === type) {
      return current;
    }
  }
  return null;
}
