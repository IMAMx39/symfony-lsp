import { Query, type Node } from 'web-tree-sitter';
import { phpStringLiteralValue } from '../../parsing/literals';
import type { Parsers } from '../../parsing/parsers';
import { declaredClassName, enclosingClass, methodNamed, namedTypeClass } from '../../parsing/phpDeclarations';
import criteriaQuery from '../../parsing/queries/php-repository-criteria.scm?raw';
import { repositoryArgument } from './RepositoryReferenceFinder';

const FUNCTION_TYPES = ['method_declaration', 'function_definition', 'anonymous_function', 'arrow_function'];

/** Where the entity of a repository call comes from. */
export type RepositorySource =
  /** `->getRepository(X::class)` */
  | { kind: 'entity'; className: string }
  /** A repository class (`$this` in a repository, typed property or parameter): its managed entity. */
  | { kind: 'repository'; repositoryClass: string };

/** A literal key of the criteria or orderBy array. Offsets cover the literal, quotes included. */
export interface CriteriaKeyReference {
  key: string;
  start: number;
  end: number;
  source: RepositorySource;
}

/** Arguments holding field names, by method: position and name. */
const ARRAY_ARGUMENTS: Readonly<Record<string, ReadonlyArray<{ position: number; name: string }>>> = {
  findBy: [
    { position: 0, name: 'criteria' },
    { position: 1, name: 'orderBy' },
  ],
  findOneBy: [
    { position: 0, name: 'criteria' },
    { position: 1, name: 'orderBy' },
  ],
  count: [{ position: 0, name: 'criteria' }],
};

/**
 * Literal keys of the criteria / orderBy arrays of `findBy()`, `findOneBy()` and `count()`, when the
 * receiver is recognized as a repository: `->getRepository(X)`, `$this` in a class (a repository),
 * `$this->prop` typed by a property or promoted parameter, a parameter typed with a class, or a
 * variable assigned once from `->getRepository(X)` in the same function.
 */
export class RepositoryCriteriaFinder {
  private readonly query: Query;

  constructor(parsers: Parsers) {
    this.query = new Query(parsers.php, criteriaQuery);
  }

  find(root: Node): CriteriaKeyReference[] {
    const references: CriteriaKeyReference[] = [];
    for (const match of this.query.matches(root)) {
      const object = match.captures.find((capture) => capture.name === 'object')?.node;
      const method = match.captures.find((capture) => capture.name === 'method')?.node.text;
      const args = match.captures.find((capture) => capture.name === 'arguments')?.node;
      const positions = method === undefined ? undefined : ARRAY_ARGUMENTS[method];
      if (!object || !args || !positions) {
        continue;
      }
      const arrays = positions.map(({ position, name }) => argumentValue(args, position, name)).filter((value) => value?.type === 'array_creation_expression');
      if (arrays.length === 0) {
        continue;
      }
      const source = receiverSource(object, root);
      if (source === null) {
        continue;
      }
      for (const array of arrays) {
        for (const key of arrayKeys(array!)) {
          const name = phpStringLiteralValue(key);
          if (name !== null) {
            references.push({ key: name, start: key.startIndex, end: key.endIndex, source });
          }
        }
      }
    }
    return references;
  }
}

/** The argument at `position` or named `name`; null after an argument unpacking. */
function argumentValue(args: Node, position: number, name: string): Node | null {
  let index = 0;
  for (const argument of args.namedChildren) {
    if (argument?.type !== 'argument') {
      continue;
    }
    if (argument.namedChildren.some((child) => child?.type === 'variadic_unpacking')) {
      return null;
    }
    const nameNode = argument.childForFieldName('name');
    if (nameNode ? nameNode.text === name : index++ === position) {
      const value = argument.namedChildren[argument.namedChildren.length - 1];
      return value && value !== nameNode ? value : null;
    }
  }
  return null;
}

/** Keys of `['key' => value]` elements, and lone values being typed (`['ow|']`). */
function arrayKeys(array: Node): Node[] {
  return array.namedChildren.flatMap((element) => (element?.type === 'array_element_initializer' && element.namedChildren[0] ? [element.namedChildren[0]] : []));
}

function receiverSource(object: Node, root: Node): RepositorySource | null {
  if (object.type === 'member_call_expression' && object.childForFieldName('name')?.text === 'getRepository') {
    const args = object.childForFieldName('arguments');
    const reference = args ? repositoryArgument(args, root) : null;
    return reference ? { kind: 'entity', className: reference.entityClass } : null;
  }
  if (object.type === 'variable_name' && object.text === '$this') {
    const declaration = enclosingClass(object);
    const className = declaration ? declaredClassName(declaration, root) : null;
    return className === null ? null : { kind: 'repository', repositoryClass: className };
  }
  if (object.type === 'member_access_expression' && object.childForFieldName('object')?.text === '$this') {
    const property = object.childForFieldName('name');
    const declaration = enclosingClass(object);
    const className = property?.type === 'name' && declaration ? propertyClass(declaration, property.text, root) : null;
    return className === null ? null : { kind: 'repository', repositoryClass: className };
  }
  if (object.type === 'variable_name') {
    return variableSource(object, root);
  }
  return null;
}

/** Class of a property of the class: declared property or promoted constructor parameter. */
function propertyClass(declaration: Node, name: string, root: Node): string | null {
  const variable = `$${name}`;
  for (const member of declaration.childForFieldName('body')?.namedChildren ?? []) {
    if (member?.type === 'property_declaration' && member.namedChildren.some((child) => child?.type === 'property_element' && child.namedChildren[0]?.text === variable)) {
      return typeClass(member.childForFieldName('type'), root);
    }
  }
  const promoted = methodNamed(declaration, '__construct')
    ?.descendantsOfType('property_promotion_parameter')
    .find((parameter) => parameter?.childForFieldName('name')?.text === variable);
  return promoted ? typeClass(promoted.childForFieldName('type'), root) : null;
}

/**
 * A variable of the enclosing function: a parameter typed with a class (never reassigned), or a
 * variable assigned exactly once, from `->getRepository(X)`.
 */
function variableSource(variable: Node, root: Node): RepositorySource | null {
  const scope = enclosingFunction(variable);
  if (!scope) {
    return null;
  }
  const assignments = scope
    .descendantsOfType('assignment_expression')
    .filter((assignment) => assignment?.childForFieldName('left')?.text === variable.text);
  const parameter = scope
    .childForFieldName('parameters')
    ?.namedChildren.find((candidate) => candidate?.childForFieldName('name')?.text === variable.text);
  if (parameter && assignments.length === 0) {
    const className = typeClass(parameter.childForFieldName('type'), root);
    return className === null ? null : { kind: 'repository', repositoryClass: className };
  }
  const [assignment] = assignments;
  const right = assignments.length === 1 && !parameter ? assignment?.childForFieldName('right') : null;
  if (right?.type === 'member_call_expression' && right.childForFieldName('name')?.text === 'getRepository') {
    const args = right.childForFieldName('arguments');
    const reference = args ? repositoryArgument(args, root) : null;
    return reference ? { kind: 'entity', className: reference.entityClass } : null;
  }
  return null;
}

/** Class of a `Foo` or `?Foo` type; null for builtins, unions and intersections. */
function typeClass(type: Node | null, root: Node): string | null {
  const named = type?.type === 'optional_type' ? type.namedChildren[0] : type;
  return named?.type === 'named_type' ? namedTypeClass(named, root) : null;
}

function enclosingFunction(node: Node): Node | null {
  for (let current = node.parent; current !== null; current = current.parent) {
    if (FUNCTION_TYPES.includes(current.type)) {
      return current;
    }
  }
  return null;
}
