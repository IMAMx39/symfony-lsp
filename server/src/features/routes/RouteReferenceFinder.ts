import { Query, type Node } from 'web-tree-sitter';
import { phpStringLiteralValue, twigStringLiteralValue } from '../../parsing/literals';
import type { DocumentLanguage, Parsers } from '../../parsing/parsers';
import phpRoutesQuery from '../../parsing/queries/php-routes.scm?raw';
import twigRoutesQuery from '../../parsing/queries/twig-routes.scm?raw';

/** A key of a route parameters array/object. Offsets cover the key node. */
export interface RouteParameterKey {
  /** Key name, null when it is not a plain literal. */
  name: string | null;
  start: number;
  end: number;
  /** `'id'` (PHP, Twig string key) rather than `id` (Twig identifier). */
  quoted: boolean;
}

/** The parameters argument (`{...}` in Twig, `[...]` in PHP). Offsets cover the brackets. */
export interface RouteParameters {
  start: number;
  end: number;
  keys: RouteParameterKey[];
  /** Ranges of the values: the cursor there is not at a key position. */
  values: Array<{ start: number; end: number }>;
}

/** A route name. `start`/`end` cover the literal or scalar (quotes included), `nameStart`/`nameEnd` the name alone. */
export interface RouteNameReference {
  name: string;
  start: number;
  end: number;
  nameStart: number;
  nameEnd: number;
}

/** A literal route name in a PHP or Twig document (quoted, without escapes). */
export interface RouteReference extends RouteNameReference {
  language: DocumentLanguage;
  parameters: RouteParameters | null;
}

export class RouteReferenceFinder {
  private readonly phpQuery: Query;
  private readonly twigQuery: Query;

  constructor(parsers: Parsers) {
    this.phpQuery = new Query(parsers.php, phpRoutesQuery);
    this.twigQuery = new Query(parsers.twig, twigRoutesQuery);
  }

  find(language: DocumentLanguage, root: Node): RouteReference[] {
    const query = language === 'php' ? this.phpQuery : this.twigQuery;
    const references: RouteReference[] = [];
    for (const match of query.matches(root)) {
      const args = match.captures.find((capture) => capture.name === 'arguments')?.node;
      const reference = args && (language === 'php' ? phpReference(args) : twigReference(args));
      if (reference) {
        references.push(reference);
      }
    }
    return references;
  }
}

function phpReference(args: Node): RouteReference | null {
  const [first, second] = args.namedChildren.filter((child): child is Node => child?.type === 'argument');
  const nameNode = first && first.childForFieldName('name') === null ? first.namedChildren[0] : null;
  const name = nameNode ? phpStringLiteralValue(nameNode) : null;
  if (!nameNode || name === null) {
    return null;
  }
  const parametersNode =
    second && (second.childForFieldName('name') === null || second.childForFieldName('name')?.text === 'parameters')
      ? second.namedChildren[second.namedChildren.length - 1]
      : null;
  return {
    name,
    start: nameNode.startIndex,
    end: nameNode.endIndex,
    nameStart: nameNode.startIndex + 1,
    nameEnd: nameNode.endIndex - 1,
    language: 'php',
    parameters: parametersNode?.type === 'array_creation_expression' ? phpParameters(parametersNode) : null,
  };
}

function twigReference(args: Node): RouteReference | null {
  const [first, second] = args.namedChildren.filter((child): child is Node => child !== null);
  const name = first ? twigStringLiteralValue(first) : null;
  if (!first || name === null) {
    return null;
  }
  return {
    name,
    start: first.startIndex,
    end: first.endIndex,
    nameStart: first.startIndex + 1,
    nameEnd: first.endIndex - 1,
    language: 'twig',
    parameters: second?.type === 'object' ? twigParameters(second) : null,
  };
}

function phpParameters(array: Node): RouteParameters {
  const parameters: RouteParameters = { start: array.startIndex, end: array.endIndex, keys: [], values: [] };
  for (const element of array.namedChildren) {
    if (element?.type !== 'array_element_initializer') {
      continue;
    }
    const [first, second] = element.namedChildren;
    if (!first) {
      continue;
    }
    if (second) {
      parameters.keys.push(phpKey(first));
      parameters.values.push({ start: second.startIndex, end: second.endIndex });
    } else if (first.type === 'string' || first.type === 'encapsed_string') {
      // `['sl|']`: a key being typed.
      parameters.keys.push(phpKey(first));
    } else {
      parameters.values.push({ start: first.startIndex, end: first.endIndex });
    }
  }
  return parameters;
}

function phpKey(node: Node): RouteParameterKey {
  return { name: phpStringLiteralValue(node), start: node.startIndex, end: node.endIndex, quoted: true };
}

function twigParameters(object: Node): RouteParameters {
  const parameters: RouteParameters = { start: object.startIndex, end: object.endIndex, keys: [], values: [] };
  for (const child of object.namedChildren) {
    if (child?.type === 'pair') {
      const key = child.childForFieldName('key');
      const value = child.childForFieldName('value');
      if (key) {
        parameters.keys.push(twigKey(key));
      }
      if (value) {
        parameters.values.push({ start: value.startIndex, end: value.endIndex });
      }
    } else if (child?.type === 'variable') {
      // `{id: 1, sl|}`: a key being typed (or the `{ id }` shorthand).
      parameters.keys.push(twigKey(child));
    } else if (child) {
      parameters.values.push({ start: child.startIndex, end: child.endIndex });
    }
  }
  return parameters;
}

function twigKey(node: Node): RouteParameterKey {
  const quoted = node.type === 'string';
  return {
    name: quoted ? twigStringLiteralValue(node) : node.type === 'variable' ? node.text : null,
    start: node.startIndex,
    end: node.endIndex,
    quoted,
  };
}
