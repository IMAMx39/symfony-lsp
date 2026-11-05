import * as fs from 'node:fs';
import * as path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { ServiceInfo } from './types';

const ATTRIBUTE_PREFIX = '@_';

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
 * Services and aliases of a container dumped by XmlDumper: the `<service>` elements directly
 * under `<services>` (inline services nested in arguments have no id and are skipped).
 * Returns null when the source is not a dumped container.
 */
export function parseContainerXml(source: string): ServiceInfo[] | null {
  let document: unknown;
  try {
    document = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: ATTRIBUTE_PREFIX,
      parseTagValue: false,
      isArray: (tagName) => tagName === 'service',
    }).parse(source);
  } catch {
    return null;
  }
  const container = isRecord(document) ? document['container'] : undefined;
  if (container === undefined) {
    return null;
  }
  const services = isRecord(container) ? container['services'] : undefined;
  const elements = isRecord(services) ? services['service'] : undefined;
  const result: ServiceInfo[] = [];
  for (const element of Array.isArray(elements) ? elements : []) {
    const id = attribute(element, 'id');
    if (id === null) {
      continue;
    }
    const alias = attribute(element, 'alias');
    result.push({
      id,
      class: alias === null ? (attribute(element, 'class')?.replace(/^\\/, '') ?? null) : null,
      alias,
      location: null,
    });
  }
  return result;
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
