import * as fs from 'node:fs';
import * as path from 'node:path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Node } from 'web-tree-sitter';
import { phpClassNameValue } from '../doctrine/phpClassNames';
import {
  EVENT_LISTENER_TAG,
  EVENT_SUBSCRIBER_TAG,
  findSourceListeners,
  implementsSubscriber,
  LISTENER_ATTRIBUTE_PARAMETERS,
  resolveDeclaration,
  subscribedListeners,
  tagListeners,
  type EventListener,
  type EventRef,
  type ListenerDeclaration,
  type ListenerTag,
} from '../events/eventListeners';
import type { Parsers } from '../parsing/parsers';
import { declaredClassName } from '../parsing/phpDeclarations';
import { ComposerAutoload } from '../project/ComposerAutoload';
import { locateClass } from '../project/classLocation';
import { withClassDeclaration, type OpenText } from '../project/classSource';
import type { ServiceTag } from '../services/types';
import { isInsidePath, pathKey, pathToUri } from '../util/paths';
import { phpFiles } from '../util/phpFiles';
import type { ServiceIndex } from './ServiceIndex';

const CLASS_LIKE = ['class_declaration', 'interface_declaration', 'enum_declaration'];

/**
 * Event listeners of a project, from:
 * - the sources of src/ (open documents override their file): `#[AsEventListener]`, classes
 *   implementing EventSubscriberInterface, and the other `kernel.event_listener` /
 *   `kernel.event_subscriber` tags of their services (YAML, container), read from the class;
 * - for classes outside src/ (vendor, bundles), the `addListener` calls of the dumped container,
 *   where RegisterListenersPass already resolved events, methods and subscribers.
 */
export class EventListenerIndex {
  /** Listener declarations by file key (files of src/ declaring at least one). */
  private readonly files = new Map<string, ListenerDeclaration[]>();
  private autoload: ComposerAutoload;

  constructor(
    private readonly projectRoot: string,
    private readonly parsers: Parsers,
    private readonly services: ServiceIndex,
  ) {
    this.autoload = ComposerAutoload.load(projectRoot);
    for (const file of phpFiles(this.sourceDir())) {
      this.updatePhpFile(file, null);
    }
  }

  /** Composer autoload changed: class files may have moved. */
  reloadAutoload(): void {
    this.autoload = ComposerAutoload.load(this.projectRoot);
  }

  /**
   * Re-reads the listeners declared by a PHP file of src/, from `content` (open document) or
   * from disk when null. Returns true when they changed.
   */
  updatePhpFile(file: string, content: string | null): boolean {
    if (!isInsidePath(file, this.sourceDir()) || !file.endsWith('.php')) {
      return false;
    }
    const key = pathKey(file);
    const source = content ?? readText(file);
    const declarations = source === null ? [] : this.extract(file, source);
    const previous = this.files.get(key) ?? [];
    if (declarations.length === 0) {
      this.files.delete(key);
    } else {
      this.files.set(key, declarations);
    }
    return JSON.stringify(previous) !== JSON.stringify(declarations);
  }

  /** Number of listener declarations (attributes and subscribed events) in src/. */
  sourceListenerCount(): number {
    return [...this.files.values()].reduce((count, declarations) => count + declarations.length, 0);
  }

  /**
   * Listeners of an event name or class (aliased to its name as RegisterListenersPass does), by
   * decreasing priority, once each per `Class::method`.
   */
  listenersOf(eventName: string, openText: OpenText = () => null): EventListener[] {
    const aliases = this.services.eventAliases();
    const written = eventName.replace(/^\\/, '');
    const event = aliases.get(written) ?? written;
    const nameOf = (ref: EventRef): string | null => ('name' in ref ? ref.name : this.constantValue(ref.className, ref.constant, openText));
    const found = new Map<string, EventListener>();
    const add = (listener: EventListener) => {
      const key = `${listener.listenerClass}::${listener.method}`.toLowerCase();
      if (listener.event === event && !found.has(key)) {
        found.set(key, listener);
      }
    };
    for (const declaration of [...[...this.files.values()].flat(), ...this.taggedDeclarations(openText)]) {
      resolveDeclaration(declaration, nameOf, aliases).forEach(add);
    }
    this.compiledListeners(event).forEach(add);
    return [...found.values()].sort((a, b) => b.priority - a.priority);
  }

  /**
   * String value of a class constant (`KernelEvents::REQUEST`), read through PSR-4: a literal or
   * `Foo::class`. Null when the constant is not declared by the class itself or not a string.
   */
  constantValue(className: string, constant: string, openText: OpenText = () => null): string | null {
    return withClassDeclaration(this.autoload, this.parsers, className, openText, CLASS_LIKE, ({ declaration, root }) => {
      for (const member of declaration.childForFieldName('body')?.namedChildren ?? []) {
        for (const element of member?.type === 'const_declaration' ? member.namedChildren : []) {
          const [name, value] = element?.type === 'const_element' ? element.namedChildren : [];
          if (name?.text === constant && value) {
            return constantString(value, root, declaration);
          }
        }
      }
      return null;
    });
  }

  /** Listeners of services outside src/, from the `addListener` calls of the dumped container. */
  private compiledListeners(event: string): EventListener[] {
    const listeners: EventListener[] = [];
    for (const call of this.services.compiledListeners()) {
      const service = call.event === event ? this.services.get(call.serviceId) : undefined;
      const className = service ? (this.services.resolve(service)?.class ?? null) : null;
      const file = className === null ? null : this.autoload.findClassFile(className);
      if (className === null || file === null || isInsidePath(file, this.sourceDir())) {
        continue;
      }
      const location = locateClass(this.autoload, this.parsers, className, call.method);
      if (location !== null) {
        listeners.push({ event, listenerClass: className, method: call.method, priority: call.priority, location });
      }
    }
    return listeners;
  }

  /**
   * Listeners from the tags of services whose class is in src/ (explicit YAML tags, subscribers
   * implementing the interface through a parent). The tags FrameworkBundle adds for an
   * `#[AsEventListener]` are left to the sources, which are newer than the dump.
   */
  private taggedDeclarations(openText: OpenText): ListenerDeclaration[] {
    const byClass = new Map<string, { listenerTags: ListenerTag[]; subscriber: boolean }>();
    const entry = (className: string) => {
      const existing = byClass.get(className) ?? { listenerTags: [], subscriber: false };
      byClass.set(className, existing);
      return existing;
    };
    for (const { service, tags } of this.services.taggedWith(EVENT_LISTENER_TAG)) {
      if (service.class !== null && this.inSources(service.class)) {
        entry(service.class).listenerTags.push(...tags.filter((tag) => !isAttributeTag(tag)).map(toListenerTag));
      }
    }
    for (const { service } of this.services.taggedWith(EVENT_SUBSCRIBER_TAG)) {
      if (service.class !== null && this.inSources(service.class)) {
        entry(service.class).subscriber = true;
      }
    }
    const declarations: ListenerDeclaration[] = [];
    for (const [className, { listenerTags, subscriber }] of byClass) {
      const found = withClassDeclaration(this.autoload, this.parsers, className, openText, 'class_declaration', ({ declaration, root, uri, text }) => {
        const declaresInterface = implementsSubscriber(declaration, root);
        return [
          ...tagListeners(declaration, root, uri, text, listenerTags, subscriber || declaresInterface),
          // A class implementing the interface itself is already read from its file.
          ...(subscriber && !declaresInterface ? subscribedListeners(declaration, root, uri, text) : []),
        ];
      });
      declarations.push(...(found ?? []));
    }
    return declarations;
  }

  private inSources(className: string): boolean {
    const file = this.autoload.findClassFile(className);
    return file !== null && isInsidePath(file, this.sourceDir());
  }

  private extract(file: string, source: string): ListenerDeclaration[] {
    if (!source.includes('AsEventListener') && !source.includes('EventSubscriberInterface')) {
      return [];
    }
    const tree = this.parsers.parse('php', source);
    if (tree === null) {
      return [];
    }
    try {
      const uri = pathToUri(file);
      return findSourceListeners(tree.rootNode, uri, TextDocument.create(uri, 'php', 0, source));
    } finally {
      tree.delete();
    }
  }

  private sourceDir(): string {
    return path.join(this.projectRoot, 'src');
  }
}

/** `'literal'` or `Foo::class` / `self::class` as the value of a constant. */
function constantString(value: Node, root: Node, declaration: Node): string | null {
  if (value.type === 'class_constant_access_expression') {
    const [target, constant] = value.namedChildren;
    if (target?.type === 'relative_scope' && target.text.toLowerCase() === 'self' && constant?.text === 'class') {
      return declaredClassName(declaration, root);
    }
  }
  if (value.type !== 'class_constant_access_expression' && value.type !== 'string' && value.type !== 'encapsed_string') {
    return null;
  }
  return phpClassNameValue(value, root);
}

/** A tag FrameworkBundle added for an `#[AsEventListener]` (it carries every attribute property). */
function isAttributeTag(tag: ServiceTag): boolean {
  return LISTENER_ATTRIBUTE_PARAMETERS.every((key) => key in tag.attributes);
}

function toListenerTag(tag: ServiceTag): ListenerTag {
  const { event, method, priority } = tag.attributes;
  const parsedPriority = priority === undefined ? NaN : Number(priority);
  return {
    event: event ? { name: event.replace(/^\\/, '') } : null,
    method: method || null,
    priority: Number.isInteger(parsedPriority) ? parsedPriority : 0,
  };
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
