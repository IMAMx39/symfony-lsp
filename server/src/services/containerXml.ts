import * as fs from 'node:fs';
import * as path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { CompiledListener, ParameterInfo, ServiceInfo, ServiceTag } from './types';

const ATTRIBUTE_PREFIX = '@_';
const TEXT_KEY = '#text';

/** Parameter mapping event classes to event names (filled by FrameworkBundle and AddEventAliasesPass). */
const EVENT_ALIASES_PARAMETER = 'event_dispatcher.event_aliases';

export interface DumpedContainer {
  services: ServiceInfo[];
  parameters: ParameterInfo[];
  /** `addListener` calls RegisterListenersPass added to the event dispatchers. */
  listeners: CompiledListener[];
  /** `event_dispatcher.event_aliases`: event class → event name. */
  eventAliases: Map<string, string>;
}

/**
 * Container dumped by the kernel in debug mode (ContainerBuilderDebugDumpPass), named after
 * the container class (`App_KernelDevDebugContainer.xml`). The most recent one wins when
 * several kernels left a dump in the cache directory.
 */
export function findContainerXml(cacheDir: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(cacheDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('Container.xml'))
    .map((entry) => path.join(cacheDir, entry.name))
    .map((file) => ({ file, mtime: modificationTime(file) }))
    .filter((candidate): candidate is { file: string; mtime: number } => candidate.mtime !== null)
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.file ?? null;
}

/**
 * Services, aliases and parameters of a container dumped by XmlDumper: the `<service>` elements
 * directly under `<services>` (inline services nested in arguments have no id and are skipped)
 * and the `<parameter>` elements directly under `<parameters>`.
 * Returns null when the source is not a dumped container.
 */
export function parseContainerXml(source: string): DumpedContainer | null {
  let document: unknown;
  try {
    document = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: ATTRIBUTE_PREFIX,
      parseTagValue: false,
      textNodeName: TEXT_KEY,
      isArray: (tagName) => ['service', 'parameter', 'tag', 'call', 'argument'].includes(tagName),
    }).parse(source);
  } catch {
    return null;
  }
  const container = isRecord(document) ? document['container'] : undefined;
  if (container === undefined) {
    return null;
  }
  const services: ServiceInfo[] = [];
  const listeners: CompiledListener[] = [];
  for (const element of children(container, 'services', 'service')) {
    const id = attribute(element, 'id');
    if (id === null) {
      continue;
    }
    listeners.push(...readListenerCalls(element));
    const alias = attribute(element, 'alias');
    const tagEntries = readTags(element);
    services.push({
      id,
      class: alias === null ? (attribute(element, 'class')?.replace(/^\\/, '') ?? null) : null,
      alias,
      tags: [...new Set(tagEntries.map((tag) => tag.name))],
      tagEntries,
      location: null,
    });
  }
  const parameters: ParameterInfo[] = [];
  const eventAliases = new Map<string, string>();
  for (const element of children(container, 'parameters', 'parameter')) {
    const name = attribute(element, 'key');
    if (name !== null) {
      parameters.push({ name, value: parameterValue(element), location: null });
    }
    if (name === EVENT_ALIASES_PARAMETER) {
      for (const [key, value] of collectionEntries(element)) {
        eventAliases.set(key.replace(/^\\/, ''), value);
      }
    }
  }
  return { services, parameters, listeners, eventAliases };
}

/**
 * `<call method="addListener">` of a dispatcher, as RegisterListenersPass writes them:
 * the event name, then `[service_closure(id), method]`, then the priority.
 */
function readListenerCalls(service: unknown): CompiledListener[] {
  const calls = isRecord(service) ? service['call'] : undefined;
  const listeners: CompiledListener[] = [];
  for (const call of Array.isArray(calls) ? calls : []) {
    if (attribute(call, 'method') !== 'addListener') {
      continue;
    }
    const [event, listener, priority] = argumentsOf(call);
    const [closure, method] = argumentsOf(listener);
    const eventName = textOf(event);
    const methodName = textOf(method);
    const serviceId = attribute(closure, 'type') === 'service_closure' ? attribute(closure, 'id') : null;
    const priorityValue = priority === undefined ? 0 : Number(textOf(priority));
    if (!eventName || !methodName || serviceId === null || attribute(listener, 'type') !== 'collection') {
      continue;
    }
    listeners.push({ event: eventName, serviceId, method: methodName, priority: Number.isInteger(priorityValue) ? priorityValue : 0 });
  }
  return listeners;
}

function argumentsOf(element: unknown): unknown[] {
  const elements = isRecord(element) ? element['argument'] : undefined;
  return Array.isArray(elements) ? elements : [];
}

/** Text of an element: plain text, or the text next to attributes (`<argument type="string">x</argument>`). */
function textOf(element: unknown): string | null {
  if (typeof element === 'string') {
    return element;
  }
  const text = isRecord(element) ? element[TEXT_KEY] : undefined;
  return typeof text === 'string' ? text : null;
}

/** Keyed scalar entries of a collection parameter (`<parameter key="k">value</parameter>`). */
function collectionEntries(element: unknown): Array<[string, string]> {
  const entries = isRecord(element) && attribute(element, 'type') === 'collection' ? element['parameter'] : undefined;
  const result: Array<[string, string]> = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = attribute(entry, 'key');
    const value = textOf(entry);
    if (key !== null && value) {
      result.push([key, value]);
    }
  }
  return result;
}

function children(container: unknown, group: string, tag: string): unknown[] {
  const parent = isRecord(container) ? container[group] : undefined;
  const elements = isRecord(parent) ? parent[tag] : undefined;
  return Array.isArray(elements) ? elements : [];
}

/**
 * The `<tag>` children of a service. XmlDumper writes the name as text instead of the `name`
 * attribute when the tag has its own `name` attribute. Nested attributes (`<attribute>`) are
 * left out.
 */
function readTags(service: unknown): ServiceTag[] {
  const tags = isRecord(service) ? service['tag'] : undefined;
  const entries: ServiceTag[] = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (typeof tag === 'string') {
      if (tag.trim() !== '') {
        entries.push({ name: tag.trim(), attributes: {} });
      }
      continue;
    }
    const text = isRecord(tag) ? tag[TEXT_KEY] : undefined;
    const textName = typeof text === 'string' && text.trim() !== '' ? text.trim() : null;
    const name = textName ?? attribute(tag, 'name');
    if (name === null || !isRecord(tag)) {
      continue;
    }
    const attributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(tag)) {
      const attributeName = key.startsWith(ATTRIBUTE_PREFIX) ? key.slice(ATTRIBUTE_PREFIX.length) : null;
      if (attributeName !== null && typeof value === 'string' && (textName !== null || attributeName !== 'name')) {
        attributes[attributeName] = value;
      }
    }
    entries.push({ name, attributes });
  }
  return entries;
}

/** Text of a scalar parameter (`<parameter key="x">text</parameter>`), null for a collection. */
function parameterValue(element: unknown): string | null {
  if (!isRecord(element) || attribute(element, 'type') === 'collection') {
    return null;
  }
  const text = element[TEXT_KEY];
  return typeof text === 'string' ? text : '';
}

function attribute(element: unknown, name: string): string | null {
  const value = isRecord(element) ? element[ATTRIBUTE_PREFIX + name] : undefined;
  return typeof value === 'string' && value !== '' ? value : null;
}

function modificationTime(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
