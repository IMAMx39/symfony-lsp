import { Query, type Node } from 'web-tree-sitter';
import { phpClassNameValue } from '../../doctrine/phpClassNames';
import { phpStringLiteralValue } from '../../parsing/literals';
import type { Parsers } from '../../parsing/parsers';
import { fileNamespace } from '../../parsing/phpNames';
import queryBuilderQuery from '../../parsing/queries/php-query-builder.scm?raw';

const FUNCTION_TYPES = ['method_declaration', 'function_definition', 'anonymous_function', 'arrow_function'];
const JOIN_METHODS = ['join', 'innerJoin', 'leftJoin'];

/** Where the entity behind a DQL alias comes from. */
export type AliasSource =
  /** `->from(X::class, 'a')`, `->join(X::class, 'a', ...)` */
  | { kind: 'entity'; className: string }
  /** `$this->createQueryBuilder('a')` in a repository: the entity of that repository. */
  | { kind: 'repository'; repositoryClass: string }
  /** `->join('p.category', 'a')`: the target of an association of another alias. */
  | { kind: 'join'; alias: string; association: string };

/** A string literal holding DQL in a QueryBuilder call. Offsets cover the literal, quotes included. */
export interface QueryBuilderReference {
  start: number;
  end: number;
  /** Aliases of the query builder; null for an alias declared several times differently. */
  aliases: ReadonlyMap<string, AliasSource | null>;
}

/**
 * DQL string literals of QueryBuilder calls whose aliases can be followed: the call belongs to a
 * chain started by `createQueryBuilder()`, or to a variable assigned once from such a chain in
 * the same function (`$qb = $qb->...` reassignments allowed). Aliases come from
 * `$this->createQueryBuilder('a')`, `->from(X, 'a')` and `->(inner|left)?join('a.b' | X, 'c')`.
 */
export class QueryBuilderReferenceFinder {
  private readonly query: Query;

  constructor(parsers: Parsers) {
    this.query = new Query(parsers.php, queryBuilderQuery);
  }

  find(root: Node): QueryBuilderReference[] {
    const references: QueryBuilderReference[] = [];
    const cache = new Map<string, ReadonlyMap<string, AliasSource | null> | null>();
    for (const match of this.query.matches(root)) {
      const call = match.captures.find((capture) => capture.name === 'call')?.node;
      const args = match.captures.find((capture) => capture.name === 'arguments')?.node;
      if (!call || !args) {
        continue;
      }
      const literals = dqlLiterals(args);
      if (literals.length === 0) {
        continue;
      }
      const builder = builderOf(call);
      if (builder === null) {
        continue;
      }
      const key = builder.kind === 'chain' ? `chain:${builder.root.startIndex}` : `var:${builder.scope.startIndex}:${builder.name}`;
      if (!cache.has(key)) {
        cache.set(key, aliasesOf(builder, root));
      }
      const aliases = cache.get(key);
      if (aliases) {
        literals.forEach((literal) => references.push({ start: literal.startIndex, end: literal.endIndex, aliases }));
      }
    }
    return references;
  }
}

type Builder = { kind: 'chain'; root: Node } | { kind: 'variable'; name: string; scope: Node };

/** Plain string literals among the arguments (and in array arguments: `->select(['a.b', 'a.c'])`). */
function dqlLiterals(args: Node): Node[] {
  const literals: Node[] = [];
  for (const argument of args.namedChildren) {
    const value = argument?.type === 'argument' ? argument.namedChildren[argument.namedChildren.length - 1] : null;
    const candidates =
      value?.type === 'array_creation_expression'
        ? value.namedChildren.map((element) => (element?.type === 'array_element_initializer' && element.namedChildren.length === 1 ? element.namedChildren[0] : null))
        : [value];
    for (const candidate of candidates) {
      if (candidate && phpStringLiteralValue(candidate) !== null) {
        literals.push(candidate);
      }
    }
  }
  return literals;
}

/** First call of a method chain (`$x->a()->b()` → `$x->a()`). */
function chainStart(call: Node): Node {
  let current = call;
  let object = current.childForFieldName('object');
  while (object?.type === 'member_call_expression') {
    current = object;
    object = current.childForFieldName('object');
  }
  return current;
}

/** Outermost call of the chain a call belongs to (`$x->a()->b()` from `$x->a()`). */
function chainEnd(call: Node): Node {
  let current = call;
  while (current.parent?.type === 'member_call_expression' && current.parent.childForFieldName('object')?.startIndex === current.startIndex) {
    current = current.parent;
  }
  return current;
}

/** The `createQueryBuilder()` call a chained call applies to (`$this->getEntityManager()->createQueryBuilder()->from()`). */
function creationIn(call: Node): Node | null {
  for (let current: Node | null = call; current?.type === 'member_call_expression'; current = current.childForFieldName('object')) {
    if (isCreation(current)) {
      return current;
    }
  }
  return null;
}

function builderOf(call: Node): Builder | null {
  const creation = creationIn(call);
  if (creation !== null) {
    return assignedVariable(chainEnd(creation)) ?? { kind: 'chain', root: creation };
  }
  const object = chainStart(call).childForFieldName('object');
  const scope = enclosingFunction(call);
  return object?.type === 'variable_name' && object.text !== '$this' && scope ? { kind: 'variable', name: object.text, scope } : null;
}

/** `$qb = <chain>`: the variable the chain is assigned to, in its function. */
function assignedVariable(chain: Node): Builder | null {
  const parent = chain.parent;
  const left = parent?.type === 'assignment_expression' ? parent.childForFieldName('left') : null;
  const scope = enclosingFunction(chain);
  return left?.type === 'variable_name' && scope ? { kind: 'variable', name: left.text, scope } : null;
}

/** Every call of the builder, or null when it cannot be followed. */
function builderCalls(builder: Builder): Node[] | null {
  if (builder.kind === 'chain') {
    return callsOfChain(builder.root);
  }
  const calls: Node[] = [];
  let created = 0;
  const inScope = (node: Node): boolean => enclosingFunction(node)?.startIndex === builder.scope.startIndex;
  for (const assignment of builder.scope.descendantsOfType('assignment_expression')) {
    if (!assignment || assignment.childForFieldName('left')?.text !== builder.name || !inScope(assignment)) {
      continue;
    }
    const right = assignment.childForFieldName('right');
    const call = right?.type === 'member_call_expression' ? right : null;
    if (call && creationIn(call) !== null) {
      created++;
    } else if (!call || chainStart(call).childForFieldName('object')?.text !== builder.name) {
      // Assigned from something else: the variable may hold another builder.
      return null;
    }
  }
  if (created !== 1) {
    return null;
  }
  for (const call of builder.scope.descendantsOfType('member_call_expression')) {
    if (!call || !inScope(call)) {
      continue;
    }
    // Each chain is collected once: from its creation, or from its first call on the variable.
    const assigned = isCreation(call) ? assignedVariable(chainEnd(call)) : null;
    const createdHere = assigned?.kind === 'variable' && assigned.name === builder.name;
    const onVariable = chainStart(call).startIndex === call.startIndex && call.childForFieldName('object')?.text === builder.name;
    if (createdHere || onVariable) {
      calls.push(...callsOfChain(call));
    }
  }
  return calls;
}

function isCreation(call: Node): boolean {
  return call.childForFieldName('name')?.text === 'createQueryBuilder';
}

function callsOfChain(start: Node): Node[] {
  const calls = [start];
  let current = start;
  while (current.parent?.type === 'member_call_expression' && current.parent.childForFieldName('object')?.startIndex === current.startIndex) {
    current = current.parent;
    calls.push(current);
  }
  return calls;
}

function aliasesOf(builder: Builder, root: Node): ReadonlyMap<string, AliasSource | null> | null {
  const calls = builderCalls(builder);
  if (calls === null) {
    return null;
  }
  const aliases = new Map<string, AliasSource | null>();
  const declare = (alias: string | null, source: AliasSource | null): void => {
    if (alias === null || source === null || !/^[A-Za-z_]\w*$/.test(alias)) {
      return;
    }
    const known = aliases.get(alias);
    aliases.set(alias, known === undefined || (known !== null && JSON.stringify(known) === JSON.stringify(source)) ? source : null);
  };
  for (const call of calls) {
    const method = call.childForFieldName('name')?.text ?? '';
    const args = callArguments(call);
    if (method === 'createQueryBuilder') {
      const repositoryClass = call.childForFieldName('object')?.text === '$this' ? enclosingClassName(call, root) : null;
      declare(literal(args.get('alias') ?? args.get(0)), repositoryClass === null ? null : { kind: 'repository', repositoryClass });
    } else if (method === 'from') {
      const from = args.get('from') ?? args.get(0);
      const className = from ? phpClassNameValue(from, root) : null;
      declare(literal(args.get('alias') ?? args.get(1)), className === null ? null : { kind: 'entity', className });
    } else if (JOIN_METHODS.includes(method)) {
      const join = args.get('join') ?? args.get(0);
      const path = join ? phpStringLiteralValue(join) : null;
      const association = path === null ? null : /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(path);
      const alias = literal(args.get('alias') ?? args.get(1));
      if (association?.[1] !== undefined && association[2] !== undefined) {
        declare(alias, { kind: 'join', alias: association[1], association: association[2] });
      } else {
        const className = join ? phpClassNameValue(join, root) : null;
        declare(alias, className === null ? null : { kind: 'entity', className });
      }
    }
  }
  return aliases;
}

/** Arguments of a call by position and by name. */
function callArguments(call: Node): Map<string | number, Node> {
  const list = new Map<string | number, Node>();
  let position = 0;
  for (const argument of call.childForFieldName('arguments')?.namedChildren ?? []) {
    const value = argument?.type === 'argument' ? argument.namedChildren[argument.namedChildren.length - 1] : null;
    if (!argument || !value) {
      continue;
    }
    const name = argument.childForFieldName('name');
    list.set(name ? name.text : position++, value);
  }
  return list;
}

function literal(node: Node | undefined): string | null {
  return node ? phpStringLiteralValue(node) : null;
}

function enclosingFunction(node: Node): Node | null {
  for (let current = node.parent; current !== null; current = current.parent) {
    if (FUNCTION_TYPES.includes(current.type)) {
      return current;
    }
  }
  return null;
}

function enclosingClassName(node: Node, root: Node): string | null {
  for (let current = node.parent; current !== null; current = current.parent) {
    if (current.type === 'class_declaration') {
      const name = current.childForFieldName('name')?.text;
      const namespace = fileNamespace(root);
      return name ? (namespace ? `${namespace}\\${name}` : name) : null;
    }
  }
  return null;
}
