import * as fs from 'node:fs';
import * as path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { ParameterInfo, ServiceInfo } from './types';

const ATTRIBUTE_PREFIX = '@_';
const TEXT_KEY = '#text';

export interface DumpedContainer {
  services: ServiceInfo[];
  parameters: ParameterInfo[];
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
      isArray: (tagName) => tagName === 'service' || tagName === 'parameter',
    }).parse(source);
  } catch {
    return null;
  }
  const container = isRecord(document) ? document['container'] : undefined;
  if (container === undefined) {
    return null;
  }
  const services: ServiceInfo[] = [];
  for (const element of children(container, 'services', 'service')) {
    const id = attribute(element, 'id');
    if (id === null) {
      continue;
    }
    const alias = attribute(element, 'alias');
    services.push({
      id,
      class: alias === null ? (attribute(element, 'class')?.replace(/^\\/, '') ?? null) : null,
      alias,
      location: null,
    });
  }
  const parameters: ParameterInfo[] = [];
  for (const element of children(container, 'parameters', 'parameter')) {
    const name = attribute(element, 'key');
    if (name !== null) {
      parameters.push({ name, value: parameterValue(element), location: null });
    }
  }
  return { services, parameters };
}

function children(container: unknown, group: string, tag: string): unknown[] {
  const parent = isRecord(container) ? container[group] : undefined;
  const elements = isRecord(parent) ? parent[tag] : undefined;
  return Array.isArray(elements) ? elements : [];
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
