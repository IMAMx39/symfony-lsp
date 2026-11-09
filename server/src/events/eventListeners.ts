import { Location, Range } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Node } from 'web-tree-sitter';
import { phpClassNameValue } from '../doctrine/phpClassNames';
import { phpStringLiteralValue } from '../parsing/literals';
import { attributesNamed, declaredClassName, directSupertypes, isAbstract, methodNamed, namedTypeClass } from '../parsing/phpDeclarations';
import { resolveClassName } from '../parsing/phpNames';

export const AS_EVENT_LISTENER = 'Symfony\\Component\\EventDispatcher\\Attribute\\AsEventListener';
export const EVENT_SUBSCRIBER_INTERFACE = 'Symfony\\Component\\EventDispatcher\\EventSubscriberInterface';
export const EVENT_LISTENER_TAG = 'kernel.event_listener';
export const EVENT_SUBSCRIBER_TAG = 'kernel.event_subscriber';

/** Base event class RegisterListenersPass refuses to guess an event from. */
const CONTRACTS_EVENT = 'Symfony\\Contracts\\EventDispatcher\\Event';

/** Parameters of AsEventListener::__construct(), in order (for positional arguments). */
export const LISTENER_ATTRIBUTE_PARAMETERS = ['event', 'method', 'priority', 'dispatcher'];

/** An event name as written: a literal (or class name), or a class constant to read. */
export type EventRef = { name: string } | { className: string; constant: string };

/** A `kernel.event_listener` tag, from the YAML, the container or an `#[AsEventListener]`. */
export interface ListenerTag {
  event: EventRef | null;
  method: string | null;
  priority: number;
}

/** A listener as declared, before constants are read and event aliases applied. */
export interface ListenerDeclaration {
  listenerClass: string;
  /** Events as written (explicit, or the classes of the method's first parameter). */
  events: EventRef[];
  /** Null: named after the event (`onKernelRequest`), else `__invoke`. */
  method: string | null;
  priority: number;
  /** Methods declared by the class itself, by lowercase name. */
  methods: Readonly<Record<string, Location>>;
  classLocation: Location;
  /** A parent class or a trait may provide methods: a missing method cannot be ruled out. */
  inheritsMethods: boolean;
}

/** A method called when an event is dispatched. */
export interface EventListener {
  /** Event name, aliases applied. */
  event: string;
  listenerClass: string;
  method: string;
  priority: number;
  /** The method name, or the class name when the method is not declared by the class itself. */
  location: Location;
}

/**
 * Listeners declared by the concrete classes of a file: `#[AsEventListener]` attributes (name
 * resolved through the `use` imports) on the class or its methods, and the `getSubscribedEvents()`
 * of classes implementing EventSubscriberInterface directly (autoconfigured as subscribers).
 */
export function findSourceListeners(root: Node, uri: string, text: TextDocument): ListenerDeclaration[] {
  const source = text.getText();
  if (!source.includes('AsEventListener') && !source.includes('EventSubscriberInterface')) {
    return [];
  }
  const declarations: ListenerDeclaration[] = [];
  for (const declaration of root.descendantsOfType('class_declaration')) {
    if (!declaration || isAbstract(declaration)) {
      continue;
    }
    const subscriber = implementsSubscriber(declaration, root);
    declarations.push(...tagListeners(declaration, root, uri, text, attributeTags(declaration, root), subscriber));
    if (subscriber) {
      declarations.push(...subscribedListeners(declaration, root, uri, text));
    }
  }
  return declarations;
}

/** The class declares `implements EventSubscriberInterface` itself. */
export function implementsSubscriber(declaration: Node, root: Node): boolean {
  return directSupertypes(declaration, root).interfaces.includes(EVENT_SUBSCRIBER_INTERFACE);
}

/**
 * Listeners registered by `kernel.event_listener` tags on a class, following
 * RegisterListenersPass: without `event`, the tag is skipped on a subscriber, else the events
 * are the classes of the first parameter's type of `method` (default `__invoke`).
 */
export function tagListeners(
  declaration: Node,
  root: Node,
  uri: string,
  text: TextDocument,
  tags: readonly ListenerTag[],
  isSubscriber: boolean,
): ListenerDeclaration[] {
  const owner = listenerClass(declaration, root, uri, text);
  if (owner === null) {
    return [];
  }
  const declarations: ListenerDeclaration[] = [];
  for (const tag of tags) {
    if (tag.event !== null) {
      declarations.push({ ...owner, events: [tag.event], method: tag.method, priority: tag.priority });
      continue;
    }
    if (isSubscriber) {
      continue;
    }
    const method = tag.method ?? '__invoke';
    const methodNode = methodNamed(declaration, method);
    const events = methodNode ? guessEvents(methodNode, root) : null;
    if (events !== null) {
      declarations.push({ ...owner, events: events.map((name) => ({ name })), method, priority: tag.priority });
    }
  }
  return declarations;
}

/**
 * Listeners of a subscriber, read from the `return [...]` of its own `getSubscribedEvents()`
 * (EventDispatcher::addSubscriber()): `'method'`, `['method', priority]` or a list of those.
 * Entries that are not literal are skipped, as is a method with any other return or a `yield`.
 */
export function subscribedListeners(declaration: Node, root: Node, uri: string, text: TextDocument): ListenerDeclaration[] {
  const owner = listenerClass(declaration, root, uri, text);
  const body = methodNamed(declaration, 'getSubscribedEvents')?.childForFieldName('body');
  const returns = body?.descendantsOfType('return_statement') ?? [];
  const returned = body?.namedChildren.find((statement) => statement?.type === 'return_statement')?.namedChildren[0];
  if (owner === null || !body || returns.length !== 1 || body.descendantsOfType('yield_expression').length > 0 || returned?.type !== 'array_creation_expression') {
    return [];
  }
  const declarations: ListenerDeclaration[] = [];
  for (const element of withoutComments(returned)) {
    const [key, value, extra] = element?.type === 'array_element_initializer' ? element.namedChildren : [];
    const event = key ? eventRefOf(key, root, owner.listenerClass) : null;
    if (!event || !value || extra) {
      continue;
    }
    for (const { method, priority } of subscribedMethods(value)) {
      declarations.push({ ...owner, events: [event], method, priority });
    }
  }
  return declarations;
}

/**
 * Event named by an expression: a string literal, `Foo::class`, or `Foo::CONSTANT` (`self::`
 * is the current class; `static::` and `parent::` are not followed).
 */
export function eventRefOf(node: Node, root: Node, currentClass: string | null): EventRef | null {
  if (node.type === 'string' || node.type === 'encapsed_string') {
    const name = phpClassNameValue(node, root);
    return name === null ? null : { name };
  }
  if (node.type !== 'class_constant_access_expression') {
    return null;
  }
  const [target, constant] = node.namedChildren;
  const className = target ? scopeClass(target, root, currentClass) : null;
  if (className === null || constant?.type !== 'name') {
    return null;
  }
  return constant.text === 'class' ? { name: className } : { className, constant: constant.text };
}

/** Class designated by the left side of `X::...`. */
export function scopeClass(target: Node, root: Node, currentClass: string | null): string | null {
  if (target.type === 'name' || target.type === 'qualified_name') {
    return resolveClassName(target.text, root);
  }
  return target.type === 'relative_scope' && target.text.toLowerCase() === 'self' ? currentClass : null;
}

/**
 * Listeners of a declaration once its events are known: aliases applied, then the default
 * method (RegisterListenersPass): `on` + the event name in camel case when the class has such a
 * method, else `__invoke`. Unknown when the class may inherit the named method.
 */
export function resolveDeclaration(
  declaration: ListenerDeclaration,
  eventName: (event: EventRef) => string | null,
  aliases: ReadonlyMap<string, string>,
): EventListener[] {
  const listeners: EventListener[] = [];
  for (const event of declaration.events) {
    const written = eventName(event);
    if (written === null || written === '') {
      continue;
    }
    const name = aliases.get(written) ?? written;
    const method = declaration.method ?? defaultMethod(declaration, name);
    if (method === null) {
      continue;
    }
    const location = declaration.methods[method.toLowerCase()] ?? declaration.classLocation;
    listeners.push({ event: name, listenerClass: declaration.listenerClass, method, priority: declaration.priority, location });
  }
  return listeners;
}

/** RegisterListenersPass: `'on'.` the event name with each word capitalized, non-alphanumerics removed. */
export function listenerMethodName(eventName: string): string {
  return 'on' + eventName.replace(/(?<=\b|_)[a-z]/gi, (letter) => letter.toUpperCase()).replace(/[^a-z0-9]/gi, '');
}

function defaultMethod(declaration: ListenerDeclaration, eventName: string): string | null {
  const named = listenerMethodName(eventName);
  if (declaration.methods[named.toLowerCase()]) {
    return named;
  }
  if (declaration.inheritsMethods) {
    return null;
  }
  return declaration.methods['__invoke'] ? '__invoke' : null;
}

/** `kernel.event_listener` tags of a class from its `#[AsEventListener]` attributes. */
function attributeTags(declaration: Node, root: Node): ListenerTag[] {
  const currentClass = declaredClassName(declaration, root);
  const tags: ListenerTag[] = [];
  for (const attribute of attributesNamed(declaration, root, AS_EVENT_LISTENER)) {
    const tag = readAttribute(attribute, root, currentClass);
    if (tag !== null) {
      tags.push(tag);
    }
  }
  for (const member of declaration.childForFieldName('body')?.namedChildren ?? []) {
    const method = member?.type === 'method_declaration' ? member.childForFieldName('name')?.text : undefined;
    if (!member || method === undefined) {
      continue;
    }
    for (const attribute of attributesNamed(member, root, AS_EVENT_LISTENER)) {
      const tag = readAttribute(attribute, root, currentClass);
      // FrameworkBundle rejects a `method` on a method attribute.
      if (tag !== null && tag.method === null) {
        tags.push({ ...tag, method });
      }
    }
  }
  return tags;
}

/**
 * Tag of an `#[AsEventListener]` attribute. Null when `event` or `method` is not a literal
 * (the attribute cannot be read); a non-literal `priority` counts as 0, it only orders listeners.
 */
function readAttribute(attribute: Node, root: Node, currentClass: string | null): ListenerTag | null {
  let event: EventRef | null = null;
  let method: string | null = null;
  let priority = 0;
  let position = 0;
  for (const argument of attribute.childForFieldName('parameters')?.namedChildren ?? []) {
    if (argument?.type !== 'argument') {
      continue;
    }
    const nameNode = argument.childForFieldName('name');
    const parameter = nameNode ? nameNode.text : LISTENER_ATTRIBUTE_PARAMETERS[position++];
    const value = argument.namedChildren[argument.namedChildren.length - 1];
    if (!value || value === nameNode) {
      return null;
    }
    if (value.type === 'null') {
      continue;
    }
    if (parameter === 'event') {
      event = eventRefOf(value, root, currentClass);
      if (event === null) {
        return null;
      }
    } else if (parameter === 'method') {
      method = phpStringLiteralValue(value);
      if (method === null || method === '') {
        return null;
      }
    } else if (parameter === 'priority') {
      priority = integerValue(value) ?? 0;
    }
  }
  return { event, method, priority };
}

/** `'method'`, `['method', priority]` or `[['method', priority], ...]`. Unreadable entries are skipped. */
function subscribedMethods(value: Node): Array<{ method: string; priority: number }> {
  const single = methodAndPriority(value);
  if (single !== null) {
    return [single];
  }
  if (value.type !== 'array_creation_expression') {
    return [];
  }
  const methods: Array<{ method: string; priority: number }> = [];
  for (const element of withoutComments(value)) {
    const [inner, extra] = element?.type === 'array_element_initializer' ? element.namedChildren : [];
    const entry = inner && !extra ? methodAndPriority(inner) : null;
    if (entry !== null) {
      methods.push(entry);
    }
  }
  return methods;
}

function methodAndPriority(value: Node): { method: string; priority: number } | null {
  if (value.type === 'string' || value.type === 'encapsed_string') {
    const method = phpStringLiteralValue(value);
    return method ? { method, priority: 0 } : null;
  }
  if (value.type !== 'array_creation_expression') {
    return null;
  }
  const values = withoutComments(value).map((element) =>
    element?.type === 'array_element_initializer' && element.namedChildren.length === 1 ? element.namedChildren[0] : undefined,
  );
  const [methodNode, priorityNode] = values;
  if (!methodNode || (methodNode.type !== 'string' && methodNode.type !== 'encapsed_string') || values.length > 2 || values.some((node) => !node)) {
    return null;
  }
  const method = phpStringLiteralValue(methodNode);
  return !method ? null : { method, priority: priorityNode ? (integerValue(priorityNode) ?? 0) : 0 };
}

function withoutComments(array: Node): Array<Node | null> {
  return array.namedChildren.filter((child) => child?.type !== 'comment');
}

function integerValue(node: Node): number | null {
  if (node.type === 'integer' && /^\d+$/.test(node.text)) {
    return Number(node.text);
  }
  if (node.type === 'unary_op_expression' && /^[-+]\s*\d+$/.test(node.text)) {
    return Number(node.text.replace(/\s+/g, ''));
  }
  return null;
}

/**
 * Classes of the first parameter's type (RegisterListenersPass::getEventFromTypeDeclaration()):
 * a class or the class members of a union, builtin types and the base Event class left out.
 * Null when there is no parameter, no type, an intersection or no class at all.
 */
function guessEvents(method: Node, root: Node): string[] | null {
  const parameters = method.childForFieldName('parameters')?.namedChildren ?? [];
  const first = parameters.find(
    (parameter) => parameter?.type === 'simple_parameter' || parameter?.type === 'property_promotion_parameter' || parameter?.type === 'variadic_parameter',
  );
  const type = first?.childForFieldName('type');
  const named = type?.type === 'optional_type' ? type.namedChildren[0] : type;
  const members = named?.type === 'named_type' ? [named] : named?.type === 'union_type' ? named.namedChildren : [];
  if (members.some((member) => member?.type === 'intersection_type')) {
    return null;
  }
  const classes = members
    .filter((member): member is Node => member?.type === 'named_type')
    .map((member) => namedTypeClass(member, root))
    .filter((className): className is string => className !== null && className !== CONTRACTS_EVENT);
  return classes.length > 0 ? classes : null;
}

/** Class name, own methods and whether others may be inherited: what every listener of the class shares. */
function listenerClass(
  declaration: Node,
  root: Node,
  uri: string,
  text: TextDocument,
): Pick<ListenerDeclaration, 'listenerClass' | 'methods' | 'classLocation' | 'inheritsMethods'> | null {
  const className = declaredClassName(declaration, root);
  const nameNode = declaration.childForFieldName('name');
  if (className === null || !nameNode) {
    return null;
  }
  const methods: Record<string, Location> = {};
  const body = declaration.childForFieldName('body');
  for (const member of body?.namedChildren ?? []) {
    const name = member?.type === 'method_declaration' ? member.childForFieldName('name') : null;
    if (name) {
      methods[name.text.toLowerCase()] = locationOf(name, uri, text);
    }
  }
  const inheritsMethods =
    directSupertypes(declaration, root).parent !== null || (body?.namedChildren.some((member) => member?.type === 'use_declaration') ?? false);
  return { listenerClass: className, methods, classLocation: locationOf(nameNode, uri, text), inheritsMethods };
}

function locationOf(node: Node, uri: string, text: TextDocument): Location {
  return Location.create(uri, Range.create(text.positionAt(node.startIndex), text.positionAt(node.endIndex)));
}
