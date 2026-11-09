import { Location, Range } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Node } from 'web-tree-sitter';
import { phpClassNameValue } from '../doctrine/phpClassNames';
import { phpStringLiteralValue } from '../parsing/literals';
import { attributesNamed, declaredClassName, isAbstract, methodNamed, namedTypeClass } from '../parsing/phpDeclarations';

export const AS_MESSAGE_HANDLER = 'Symfony\\Component\\Messenger\\Attribute\\AsMessageHandler';
export const MESSAGE_HANDLER_TAG = 'messenger.message_handler';

/** Parameters of AsMessageHandler::__construct(), in order (for positional arguments). */
const ATTRIBUTE_PARAMETERS = ['bus', 'fromTransport', 'handles', 'method', 'priority', 'sign'];

/** A `messenger.message_handler` tag, from the container, the YAML or an `#[AsMessageHandler]`. */
export interface HandlerTag {
  /** Message class given explicitly (`handles`), else guessed from the method's first parameter. */
  handles: string | null;
  /** Method handling the message, `__invoke` when null. */
  method: string | null;
  priority: number;
  /** The tag has attributes: option-less tags are dropped when a service has configured ones. */
  configured: boolean;
}

/** A method that handles messages, as MessengerPass registers it. */
export interface MessageHandler {
  handlerClass: string;
  method: string;
  /** Classes or interfaces of the messages it handles (`*`: every message). */
  messages: string[];
  priority: number;
  /** The method name, or the class name when the method is not declared by the class itself. */
  location: Location;
}

/**
 * Handlers declared with `#[AsMessageHandler]` (name resolved through the `use` imports) on the
 * concrete classes of a file: on the class (`method` or `__invoke`) or on a method (that method).
 * Abstract classes are skipped (registered as excluded definitions), as are attributes with a
 * non-literal value and method attributes declaring a `method` (rejected by FrameworkBundle).
 */
export function findAttributeHandlers(root: Node, uri: string, text: TextDocument): MessageHandler[] {
  const handlers: MessageHandler[] = [];
  if (!text.getText().includes('AsMessageHandler')) {
    return handlers;
  }
  for (const declaration of root.descendantsOfType('class_declaration')) {
    if (!declaration || isAbstract(declaration)) {
      continue;
    }
    const tags = attributeTags(declaration, root);
    if (tags.length > 0) {
      handlers.push(...classHandlers(declaration, root, uri, text, tags));
    }
  }
  return handlers;
}

/** `messenger.message_handler` tags of a class from its `#[AsMessageHandler]` attributes. */
function attributeTags(declaration: Node, root: Node): HandlerTag[] {
  const tags: HandlerTag[] = [];
  for (const attribute of attributesNamed(declaration, root, AS_MESSAGE_HANDLER)) {
    const tag = readAttribute(attribute, root);
    if (tag !== null) {
      tags.push(tag);
    }
  }
  const body = declaration.childForFieldName('body');
  for (const member of body?.namedChildren ?? []) {
    const method = member?.type === 'method_declaration' ? member.childForFieldName('name')?.text : undefined;
    if (!member || method === undefined) {
      continue;
    }
    for (const attribute of attributesNamed(member, root, AS_MESSAGE_HANDLER)) {
      const tag = readAttribute(attribute, root);
      if (tag !== null && tag.method === null) {
        tags.push({ ...tag, method });
      }
    }
  }
  return tags;
}

/**
 * Handlers registered by tags on a class, following MessengerPass::registerHandlers(): explicit
 * `handles`, else the classes of the first parameter's type (union members included). A tag
 * whose message cannot be read from the source (inherited method, untyped or scalar parameter,
 * intersection type) registers nothing here.
 */
export function classHandlers(declaration: Node, root: Node, uri: string, text: TextDocument, tags: readonly HandlerTag[]): MessageHandler[] {
  const handlerClass = declaredClassName(declaration, root);
  const configured = tags.filter((tag) => tag.configured);
  const handlers: MessageHandler[] = [];
  for (const tag of configured.length > 0 ? configured : tags) {
    const method = tag.method ?? '__invoke';
    const methodNode = methodNamed(declaration, method);
    const messages = tag.handles !== null ? [tag.handles] : methodNode ? guessHandledMessages(methodNode, root) : null;
    const target = methodNode?.childForFieldName('name') ?? declaration.childForFieldName('name');
    if (handlerClass === null || messages === null || !target) {
      continue;
    }
    const location = Location.create(uri, Range.create(text.positionAt(target.startIndex), text.positionAt(target.endIndex)));
    handlers.push({ handlerClass, method, messages, priority: tag.priority, location });
  }
  return handlers;
}

/**
 * Classes of the first parameter's type (MessengerPass::guessHandledClasses()): a class, or the
 * class members of a union (`?Foo` is `Foo`). Null when the method has no required first
 * parameter, or when its type is missing, scalar or an intersection.
 */
function guessHandledMessages(method: Node, root: Node): string[] | null {
  const parameters = method.childForFieldName('parameters')?.namedChildren ?? [];
  const first = parameters.find(
    (parameter) => parameter?.type === 'simple_parameter' || parameter?.type === 'property_promotion_parameter' || parameter?.type === 'variadic_parameter',
  );
  if (!first || first.type === 'variadic_parameter' || first.childForFieldName('default_value') !== null) {
    return null;
  }
  const type = first.childForFieldName('type');
  const named = type?.type === 'optional_type' ? type.namedChildren[0] : type;
  if (named?.type === 'named_type') {
    const className = namedTypeClass(named, root);
    return className === null ? null : [className];
  }
  if (named?.type === 'union_type') {
    const classes = named.namedChildren
      .filter((member): member is Node => member?.type === 'named_type')
      .map((member) => namedTypeClass(member, root));
    return classes.length > 0 && classes.every((className): className is string => className !== null) ? classes : null;
  }
  return null;
}

/**
 * Tag of an `#[AsMessageHandler]` attribute. Null when `handles` or `method` is not a literal
 * (the attribute cannot be read) — a non-literal `priority` counts as 0, it only orders handlers.
 */
function readAttribute(attribute: Node, root: Node): HandlerTag | null {
  let handles: string | null = null;
  let method: string | null = null;
  let priority = 0;
  let position = 0;
  for (const argument of attribute.childForFieldName('parameters')?.namedChildren ?? []) {
    if (argument?.type !== 'argument') {
      continue;
    }
    const nameNode = argument.childForFieldName('name');
    const parameter = nameNode ? nameNode.text : ATTRIBUTE_PARAMETERS[position++];
    const value = argument.namedChildren[argument.namedChildren.length - 1];
    if (!value || value === nameNode) {
      return null;
    }
    const isNull = value.type === 'null';
    if (parameter === 'handles' && !isNull) {
      handles = phpClassNameValue(value, root);
      if (handles === null) {
        return null;
      }
    } else if (parameter === 'method' && !isNull) {
      method = phpStringLiteralValue(value);
      if (method === null || method === '') {
        return null;
      }
    } else if (parameter === 'priority' && value.type === 'integer') {
      priority = Number(value.text);
    } else if (parameter === 'priority' && value.type === 'unary_op_expression' && /^-\s*\d+$/.test(value.text)) {
      priority = -Number(value.text.replace(/^-\s*/, ''));
    }
  }
  return { handles, method, priority, configured: true };
}
