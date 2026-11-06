import { Query, type Node } from 'web-tree-sitter';
import { phpStringLiteralValue } from '../../parsing/literals';
import type { Parsers } from '../../parsing/parsers';
import { resolveClassName } from '../../parsing/phpNames';
import autowireQuery from '../../parsing/queries/php-autowire.scm?raw';
import { envReferenceOf, type EnvReference } from '../../services/envPlaceholders';
import { findPlaceholders, type ParameterReference } from '../../services/parameterPlaceholders';
import type { ServiceReference } from '../../services/yamlServices';

const AUTOWIRE_ATTRIBUTE = 'Symfony\\Component\\DependencyInjection\\Attribute\\Autowire';

/** Parameters of Autowire::__construct(), in order (for positional arguments). */
const AUTOWIRE_PARAMETERS = ['value', 'service', 'expression', 'env', 'param', 'lazy'];

export type { ParameterReference };

export interface AutowireReferences {
  services: ServiceReference[];
  parameters: ParameterReference[];
  /** `env: 'NAME'` and `%env(NAME)%` placeholders of the value. */
  env: EnvReference[];
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
    const references: AutowireReferences = { services: [], parameters: [], env: [] };
    for (const match of this.query.matches(root)) {
      const attributeName = match.captures.find((capture) => capture.name === 'attribute')?.node;
      const args = match.captures.find((capture) => capture.name === 'arguments')?.node;
      const attribute = args?.parent;
      if (attributeName && args && attribute && resolveClassName(attributeName.text, root) === AUTOWIRE_ATTRIBUTE) {
        readArguments(args, references, allowsMissingService(attribute));
      }
    }
    return references;
  }
}

/**
 * True unless the attribute is on a parameter that must receive a service: a nullable, untyped
 * or defaulted parameter may get null for a missing service (ReflectionParameter::allowsNull()).
 */
function allowsMissingService(attribute: Node): boolean {
  // attribute → attribute_group → attribute_list → parameter
  const parameter = attribute.parent?.parent?.parent;
  if (!parameter || !['simple_parameter', 'property_promotion_parameter', 'variadic_parameter'].includes(parameter.type)) {
    return true;
  }
  const type = parameter.childForFieldName('type');
  return (
    type === null ||
    parameter.childForFieldName('default_value') !== null ||
    type.type === 'optional_type' ||
    /\b(null|mixed)\b/i.test(type.text)
  );
}

function readArguments(args: Node, references: AutowireReferences, optional: boolean): void {
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
        references.services.push({
          id: value,
          start: valueNode.startIndex,
          end: valueNode.endIndex,
          idStart: contentStart,
          idEnd: contentEnd,
          optional,
        });
        break;
      case 'env':
        references.env.push({ start: contentStart, end: contentEnd, closing: { end: contentEnd, text: '' } });
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
              optional,
            });
          }
        } else {
          for (const placeholder of findPlaceholders(value)) {
            const env = envReferenceOf(placeholder, contentStart);
            if (env) {
              references.env.push(env);
              continue;
            }
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
