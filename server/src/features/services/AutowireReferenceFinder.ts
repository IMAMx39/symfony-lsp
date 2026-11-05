import { Query, type Node } from 'web-tree-sitter';
import { phpStringLiteralValue } from '../../parsing/literals';
import type { Parsers } from '../../parsing/parsers';
import { resolveClassName } from '../../parsing/phpNames';
import autowireQuery from '../../parsing/queries/php-autowire.scm?raw';
import { findPlaceholders } from '../../services/parameterPlaceholders';
import type { ServiceReference } from '../../services/yamlServices';

const AUTOWIRE_ATTRIBUTE = 'Symfony\\Component\\DependencyInjection\\Attribute\\Autowire';

/** Parameters of Autowire::__construct(), in order (for positional arguments). */
const AUTOWIRE_PARAMETERS = ['value', 'service', 'expression', 'env', 'param', 'lazy'];

/**
 * A parameter name in a document. `start`/`end` cover the `%name%` placeholder, or the whole
 * literal for `param: 'name'`; `nameStart`/`nameEnd` the name alone. `closed` is false for a
 * trailing `%name` being typed (completion then adds the closing `%`).
 */
export interface ParameterReference {
  name: string;
  start: number;
  end: number;
  nameStart: number;
  nameEnd: number;
  closed: boolean;
}

export interface AutowireReferences {
  services: ServiceReference[];
  parameters: ParameterReference[];
}

/**
 * Literal arguments of `#[Autowire]` (Symfony\Component\DependencyInjection\Attribute):
 * `service: 'id'`, `param: 'name'`, and the value: `'@id'` (not `@@`, `@=`) or a string with
 * `%name%` placeholders. `expression` and `env` are ignored.
 */
export class AutowireReferenceFinder {
  private readonly query: Query;

  constructor(parsers: Parsers) {
    this.query = new Query(parsers.php, autowireQuery);
  }

  find(root: Node): AutowireReferences {
    const references: AutowireReferences = { services: [], parameters: [] };
    for (const match of this.query.matches(root)) {
      const attribute = match.captures.find((capture) => capture.name === 'attribute')?.node;
      const args = match.captures.find((capture) => capture.name === 'arguments')?.node;
      if (attribute && args && resolveClassName(attribute.text, root) === AUTOWIRE_ATTRIBUTE) {
        readArguments(args, references);
      }
    }
    return references;
  }
}

function readArguments(args: Node, references: AutowireReferences): void {
  let position = 0;
  for (const argument of args.namedChildren) {
    if (argument?.type !== 'argument') {
      continue;
    }
    const nameNode = argument.childForFieldName('name');
    const parameter = nameNode ? nameNode.text : AUTOWIRE_PARAMETERS[position++];
    const valueNode = argument.namedChildren[argument.namedChildren.length - 1];
    const value = valueNode && valueNode !== nameNode ? phpStringLiteralValue(valueNode) : null;
    if (!valueNode || value === null) {
      continue;
    }
    const contentStart = valueNode.startIndex + 1;
    const contentEnd = valueNode.endIndex - 1;
    switch (parameter) {
      case 'service':
        references.services.push({ id: value, start: valueNode.startIndex, end: valueNode.endIndex, idStart: contentStart, idEnd: contentEnd });
        break;
      case 'param':
        references.parameters.push({
          name: value,
          start: valueNode.startIndex,
          end: valueNode.endIndex,
          nameStart: contentStart,
          nameEnd: contentEnd,
          closed: true,
        });
        break;
      case 'value':
        if (value.startsWith('@')) {
          // Autowire::__construct(): `@@` is an escaped `@`, `@=` an expression, `@` a reference.
          if (!value.startsWith('@@') && !value.startsWith('@=')) {
            references.services.push({
              id: value.slice(1),
              start: valueNode.startIndex,
              end: valueNode.endIndex,
              idStart: contentStart + 1,
              idEnd: contentEnd,
            });
          }
        } else {
          for (const placeholder of findPlaceholders(value)) {
            references.parameters.push({
              name: placeholder.name,
              start: contentStart + placeholder.start,
              end: contentStart + placeholder.nameEnd + (placeholder.closed ? 1 : 0),
              nameStart: contentStart + placeholder.nameStart,
              nameEnd: contentStart + placeholder.nameEnd,
              closed: placeholder.closed,
            });
          }
        }
        break;
    }
  }
}
