import * as fs from 'node:fs';
import * as path from 'node:path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  classHandlers,
  directSupertypes,
  findAttributeHandlers,
  MESSAGE_HANDLER_TAG,
  type HandlerTag,
  type MessageHandler,
} from '../messenger/messageHandlers';
import type { Parsers } from '../parsing/parsers';
import { ComposerAutoload } from '../project/ComposerAutoload';
import { withClassDeclaration, type OpenText } from '../project/classSource';
import type { ServiceTag } from '../services/types';
import { isInsidePath, pathKey, pathToUri } from '../util/paths';
import { phpFiles } from '../util/phpFiles';
import type { ServiceIndex } from './ServiceIndex';

/** Depth limit when walking parents and interfaces (guards against cycles). */
const MAX_DEPTH = 8;

const CLASS_LIKE = ['class_declaration', 'interface_declaration', 'enum_declaration'];

/** Attributes of the tag FrameworkBundle adds for an `#[AsMessageHandler]` (get_object_vars()). */
const ATTRIBUTE_TAG_KEYS = ['bus', 'from_transport', 'handles', 'method', 'priority', 'sign'];

/**
 * Message handlers of a project, from:
 * - the `#[AsMessageHandler]` attributes of src/ (open documents override their file);
 * - the `messenger.message_handler` tags of the container dump and of the services YAML (bundle
 *   handlers, `_instanceof`, explicit tags), whose class is read through PSR-4 to guess the
 *   message. In src/, the attribute tags of the dump are left to the sources, which are newer.
 */
export class MessageHandlerIndex {
  /** Attribute handlers by file key (files of src/ declaring at least one). */
  private readonly files = new Map<string, MessageHandler[]>();
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
   * Re-reads the attribute handlers of a PHP file of src/, from `content` (open document) or
   * from disk when null. Returns true when they changed.
   */
  updatePhpFile(file: string, content: string | null): boolean {
    if (!isInsidePath(file, this.sourceDir()) || !file.endsWith('.php')) {
      return false;
    }
    const key = pathKey(file);
    const source = content ?? readText(file);
    const handlers = source === null ? [] : this.extract(file, source);
    const previous = this.files.get(key) ?? [];
    if (handlers.length === 0) {
      this.files.delete(key);
    } else {
      this.files.set(key, handlers);
    }
    return JSON.stringify(previous) !== JSON.stringify(handlers);
  }

  /** Number of handlers declared by attributes in src/. */
  attributeHandlerCount(): number {
    return [...this.files.values()].reduce((count, handlers) => count + handlers.length, 0);
  }

  /**
   * Handlers that receive a message of this class, in the order HandlersLocator looks types up:
   * the class, its parents, then its interfaces (higher priority first within a type). Handlers
   * of every message (`*`) are left out: they say nothing about the class.
   */
  handlersOf(messageClass: string, openText: OpenText = () => null): MessageHandler[] {
    const types = this.messageTypes(messageClass.replace(/^\\/, ''), openText);
    const rank = new Map(types.map((type, index) => [type, index]));
    const found = new Map<string, { handler: MessageHandler; rank: number }>();
    for (const handler of [...[...this.files.values()].flat(), ...this.taggedHandlers(openText)]) {
      const ranks = handler.messages.map((message) => rank.get(message)).filter((value): value is number => value !== undefined);
      if (ranks.length === 0) {
        continue;
      }
      // HandlersLocator yields a handler once (by its Class::method name).
      const key = `${handler.handlerClass}::${handler.method}`.toLowerCase();
      const best = Math.min(...ranks);
      const existing = found.get(key);
      if (!existing || best < existing.rank) {
        found.set(key, { handler, rank: best });
      }
    }
    return [...found.values()]
      .sort((a, b) => a.rank - b.rank || b.handler.priority - a.handler.priority)
      .map((entry) => entry.handler);
  }

  /** The class, its parents (nearest first), then every interface (class_parents + class_implements). */
  private messageTypes(messageClass: string, openText: OpenText): string[] {
    const classes: string[] = [];
    const interfaces: string[] = [];
    const read = (className: string) =>
      withClassDeclaration(this.autoload, this.parsers, className, openText, CLASS_LIKE, ({ declaration, root }) =>
        directSupertypes(declaration, root),
      );
    let current: string | null = messageClass;
    const pendingInterfaces: string[] = [];
    while (current !== null && classes.length <= MAX_DEPTH && !classes.includes(current)) {
      classes.push(current);
      const supertypes = read(current);
      pendingInterfaces.push(...(supertypes?.interfaces ?? []));
      current = supertypes?.parent ?? null;
    }
    for (let depth = 0; pendingInterfaces.length > 0 && depth <= MAX_DEPTH; depth++) {
      const level = pendingInterfaces.splice(0).filter((name) => !interfaces.includes(name) && !classes.includes(name));
      interfaces.push(...new Set(level));
      for (const name of new Set(level)) {
        pendingInterfaces.push(...(read(name)?.interfaces ?? []));
      }
    }
    return [...classes, ...interfaces];
  }

  /** Handlers registered by the `messenger.message_handler` tags of the container and the YAML. */
  private taggedHandlers(openText: OpenText): MessageHandler[] {
    const handlers: MessageHandler[] = [];
    for (const { service, tags } of this.services.taggedWith(MESSAGE_HANDLER_TAG)) {
      const className = service.class;
      const file = className === null ? null : this.autoload.findClassFile(className);
      if (className === null || file === null) {
        continue;
      }
      const inSources = isInsidePath(file, this.sourceDir());
      const handlerTags = tags.filter((tag) => !(inSources && isAttributeTag(tag))).map(toHandlerTag);
      if (handlerTags.length === 0) {
        continue;
      }
      const found = withClassDeclaration(this.autoload, this.parsers, className, openText, 'class_declaration', ({ declaration, root, uri, text }) =>
        classHandlers(declaration, root, uri, text, handlerTags),
      );
      handlers.push(...(found ?? []));
    }
    return handlers;
  }

  private extract(file: string, source: string): MessageHandler[] {
    if (!source.includes('AsMessageHandler')) {
      return [];
    }
    const tree = this.parsers.parse('php', source);
    if (tree === null) {
      return [];
    }
    try {
      const uri = pathToUri(file);
      return findAttributeHandlers(tree.rootNode, uri, TextDocument.create(uri, 'php', 0, source));
    } finally {
      tree.delete();
    }
  }

  private sourceDir(): string {
    return path.join(this.projectRoot, 'src');
  }
}

/** A tag FrameworkBundle added for an `#[AsMessageHandler]` (it carries every attribute property). */
function isAttributeTag(tag: ServiceTag): boolean {
  return ATTRIBUTE_TAG_KEYS.every((key) => key in tag.attributes);
}

function toHandlerTag(tag: ServiceTag): HandlerTag {
  const { handles, method, priority } = tag.attributes;
  const parsedPriority = priority === undefined ? NaN : Number(priority);
  return {
    handles: handles ? handles.replace(/^\\/, '') : null,
    method: method || null,
    priority: Number.isInteger(parsedPriority) ? parsedPriority : 0,
    configured: Object.keys(tag.attributes).length > 0,
  };
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
