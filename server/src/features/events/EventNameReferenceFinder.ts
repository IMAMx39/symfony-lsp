import { Query, type Node } from 'web-tree-sitter';
import { AS_EVENT_LISTENER, LISTENER_ATTRIBUTE_PARAMETERS, scopeClass, type EventRef } from '../../events/eventListeners';
import { phpClassNameValue } from '../../doctrine/phpClassNames';
import type { Parsers } from '../../parsing/parsers';
import { declaredClassName, enclosingClass } from '../../parsing/phpDeclarations';
import { resolveClassName } from '../../parsing/phpNames';
import eventNamesQuery from '../../parsing/queries/php-event-names.scm?raw';

/** An event name in PHP code. Offsets cover the constant name or the string literal. */
export interface EventNameReference {
  event: EventRef;
  start: number;
  end: number;
}

/**
 * Event names written as `Foo::CONSTANT` (anywhere: the value is checked against the listeners),
 * or as string literals where an event name is expected: the second argument of `->dispatch()`
 * (`eventName:`), the `event` of `#[AsEventListener]` and the keys returned by
 * `getSubscribedEvents()`.
 */
export class EventNameReferenceFinder {
  private readonly query: Query;

  constructor(parsers: Parsers) {
    this.query = new Query(parsers.php, eventNamesQuery);
  }

  find(root: Node): EventNameReference[] {
    const references: EventNameReference[] = [];
    for (const match of this.query.matches(root)) {
      const capture = (name: string) => match.captures.find((candidate) => candidate.name === name)?.node;
      const constant = capture('constant');
      const scope = capture('scope');
      const dispatchArguments = capture('dispatch_arguments');
      const attribute = capture('attribute');
      const key = capture('key');
      if (constant && scope && constant.text !== 'class') {
        const owner = enclosingClass(scope);
        const className = scopeClass(scope, root, owner ? declaredClassName(owner, root) : null);
        if (className !== null) {
          references.push({ event: { className, constant: constant.text }, start: constant.startIndex, end: constant.endIndex });
        }
      } else if (dispatchArguments) {
        pushLiteral(references, argumentValue(dispatchArguments, 'eventName', 1), root);
      } else if (attribute && resolveClassName(attribute.text, root) === AS_EVENT_LISTENER) {
        pushLiteral(references, argumentValue(capture('attribute_arguments'), 'event', LISTENER_ATTRIBUTE_PARAMETERS.indexOf('event')), root);
      } else if (key) {
        pushLiteral(references, key, root);
      }
    }
    return references;
  }
}

function pushLiteral(references: EventNameReference[], node: Node | undefined, root: Node): void {
  if (node?.type !== 'string' && node?.type !== 'encapsed_string') {
    return;
  }
  const name = phpClassNameValue(node, root);
  if (name !== null) {
    references.push({ event: { name }, start: node.startIndex, end: node.endIndex });
  }
}

/** Value of the argument named `name`, else of the positional argument at `position`. */
function argumentValue(argumentsNode: Node | undefined, name: string, position: number): Node | undefined {
  const argumentNodes = (argumentsNode?.namedChildren ?? []).filter((child): child is Node => child?.type === 'argument');
  const named = argumentNodes.find((argument) => argument.childForFieldName('name')?.text === name);
  const argument = named ?? argumentNodes.filter((candidate) => candidate.childForFieldName('name') === null)[position];
  if (!argument || (named === undefined && argumentNodes.slice(0, position).some((candidate) => candidate.childForFieldName('name') !== null))) {
    return undefined;
  }
  return argument.namedChildren[argument.namedChildren.length - 1] ?? undefined;
}
