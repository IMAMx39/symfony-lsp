import { Location, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { isMap, isScalar, isSeq, parseDocument, type Document, type Pair, type YAMLMap } from 'yaml';
import type { ClassReference, ServiceReference } from '../services/yamlServices';
import { pathToUri } from '../util/paths';

/** Same shape as the class names ResolveClassPass accepts as a service id (namespaced only). */
const NAMESPACED_CLASS = /^[A-Za-z_\x7f-￿][\w\x7f-￿]*(?:\\[A-Za-z_\x7f-￿][\w\x7f-￿]*)+$/;

/** Firewall options holding a service id (SecurityExtension: `new Reference()` / alias / ChildDefinition). */
const FIREWALL_SERVICE_KEYS = ['user_checker', 'access_denied_handler'];
/** Options of an authenticator block (AbstractFactory) holding a service id used as a parent definition. */
const AUTHENTICATOR_SERVICE_KEYS = ['success_handler', 'failure_handler'];

/** A user provider declared under `security.providers`. */
export interface ProviderDeclaration {
  name: string;
  /** Provider type: the factory key (`entity`, `memory`, `ldap`…), `id` or `chain`; null when not set. */
  type: string | null;
  /** `entity.class` of an entity provider. */
  entityClass: string | null;
  /** `id` of a service provider. */
  serviceId: string | null;
  location: Location;
}

/** A name in the YAML. `start`/`end` cover the scalar (quotes included), `nameStart`/`nameEnd` the name alone. */
export interface NameReference {
  name: string;
  start: number;
  end: number;
  nameStart: number;
  nameEnd: number;
}

/** `property:` of an entity provider: a mapped field of `entityClass`. */
export interface EntityPropertyReference extends NameReference {
  entityClass: string;
}

/** References found in the `security:` blocks of a YAML file. */
export interface SecurityReferences {
  /** User provider names: `provider:` of a firewall or of one of its blocks, `chain.providers`. */
  providers: NameReference[];
  /** Service ids (no `@` here): provider `id`, firewall `user_checker`, `entry_point`, handlers, custom authenticators. */
  services: ServiceReference[];
  /** Entity class of a provider, and service ids that are class names. */
  classes: ClassReference[];
  entityProperties: EntityPropertyReference[];
}

/**
 * User providers declared in the `security:` blocks of a YAML configuration file (the root one
 * and the one of `when@<env>`). Returns null when the file is not valid YAML.
 */
export function parseSecurityProviders(source: string, file: string, env: string): ProviderDeclaration[] | null {
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    return null;
  }
  const text = TextDocument.create(pathToUri(file), 'yaml', 0, source);
  const declarations: ProviderDeclaration[] = [];
  for (const security of securityBlocks(document, env)) {
    for (const pair of mapEntries(security.get('providers', true))) {
      const name = scalarString(pair.key);
      const range = (pair.key as { range?: [number, number, number] } | null)?.range;
      if (name === null || !range) {
        continue;
      }
      const definition = isMap(pair.value) ? pair.value : null;
      const type = definition?.items.map((item) => scalarString(item.key)).find((key) => key !== null) ?? null;
      const entity = definition?.get('entity', true);
      const entityClass = isMap(entity) ? scalarString(entity.get('class', true)) : null;
      declarations.push({
        name,
        type,
        entityClass: entityClass === null ? null : entityClass.replace(/^\\/, ''),
        serviceId: definition ? scalarString(definition.get('id', true)) : null,
        location: Location.create(text.uri, Range.create(text.positionAt(range[0]), text.positionAt(range[1]))),
      });
    }
  }
  return declarations;
}

/** True when the file declares something under `security:` (root or `when@<env>`). */
export function hasSecurityConfig(source: string, env: string): boolean {
  return securityBlocks(parseDocument(source), env).length > 0;
}

/** True when the file has `imports:` (root or `when@<env>`): imported files are not read. */
export function hasImports(source: string, env: string): boolean {
  const root = parseDocument(source).contents;
  if (!isMap(root)) {
    return false;
  }
  const envBlock = root.get(`when@${env}`, true);
  return root.has('imports') || (isMap(envBlock) && envBlock.has('imports'));
}

/**
 * References of the `security:` blocks (root and `when@<env>`; other environments are not
 * loaded). Only scalars whose source text is their value are read (plain, or quoted without
 * escapes, on one line), plus empty values for completion. Works on files being edited.
 */
export function findSecurityReferences(source: string, env: string): SecurityReferences {
  const references: SecurityReferences = { providers: [], services: [], classes: [], entityProperties: [] };
  const addService = (node: unknown, optional: boolean): void => {
    const text = textOf(node, source);
    if (text === null) {
      return;
    }
    references.services.push({ id: text.name, start: text.start, end: text.end, idStart: text.nameStart, idEnd: text.nameEnd, optional });
    addClass(text);
  };
  const addClass = (text: NameReference): void => {
    const className = text.name.replace(/^\\/, '');
    if (NAMESPACED_CLASS.test(className)) {
      references.classes.push({ className, start: text.start, end: text.end });
    }
  };
  const addProvider = (node: unknown): void => {
    const text = textOf(node, source);
    if (text !== null) {
      references.providers.push(text);
    }
  };

  for (const security of securityBlocks(parseDocument(source), env)) {
    for (const pair of mapEntries(security.get('providers', true))) {
      if (!isMap(pair.value)) {
        continue;
      }
      addService(pair.value.get('id', true), false);
      const chain = pair.value.get('chain', true);
      const chained = isMap(chain) ? chain.get('providers', true) : null;
      if (isSeq(chained)) {
        chained.items.forEach(addProvider);
      } else {
        // A string is split on commas (MainConfiguration).
        const text = textOf(chained, source);
        references.providers.push(...(text === null ? [] : splitList(text)));
      }
      const entity = pair.value.get('entity', true);
      if (isMap(entity)) {
        const entityClass = textOf(entity.get('class', true), source);
        if (entityClass !== null) {
          addClass(entityClass);
          const property = textOf(entity.get('property', true), source);
          if (property !== null && entityClass.name !== '') {
            references.entityProperties.push({ ...property, entityClass: entityClass.name.replace(/^\\/, '') });
          }
        }
      }
    }

    for (const firewall of mapEntries(security.get('firewalls', true))) {
      if (!isMap(firewall.value)) {
        continue;
      }
      const options = firewall.value;
      addProvider(options.get('provider', true));
      FIREWALL_SERVICE_KEYS.forEach((key) => addService(options.get(key, true), false));
      // The entry point is an authenticator key of the firewall (`form_login`) or a service id;
      // RegisterEntryPointPass reports errors itself, so a missing one is not diagnosed.
      const entryPoint = options.get('entry_point', true);
      const entryPointName = scalarString(entryPoint);
      if (entryPointName === null || !options.has(entryPointName)) {
        addService(entryPoint, true);
      }
      const authenticators = options.get('custom_authenticators', true);
      if (isSeq(authenticators)) {
        authenticators.items.forEach((item) => addService(item, false));
      }
      for (const block of options.items) {
        if (isMap(block.value)) {
          // Authenticators (AbstractFactory, HttpBasicFactory…) and switch_user take a provider.
          addProvider(block.value.get('provider', true));
          AUTHENTICATOR_SERVICE_KEYS.forEach((key) => addService((block.value as YAMLMap).get(key, true), false));
        }
      }
    }
  }
  return references;
}

/**
 * Lenient key of a provider name: `-` read as `_` (as for `provider:` of a firewall) and lower
 * case (as for `chain.providers`, resolved through `strtolower()`). Every name SecurityExtension
 * resolves has the key of a declared provider, so a name without one is certainly unknown.
 */
export function providerKey(name: string): string {
  return name.replace(/-/g, '_').toLowerCase();
}

/** The `security:` maps of the file: the root one, then the one of `when@<env>`. */
function securityBlocks(document: Document, env: string): YAMLMap[] {
  const root = document.contents;
  if (!isMap(root)) {
    return [];
  }
  const blocks: YAMLMap[] = [];
  for (const pair of root.items) {
    const key = scalarString(pair.key);
    const block = key === 'security' ? pair.value : key === `when@${env}` && isMap(pair.value) ? pair.value.get('security', true) : null;
    if (isMap(block)) {
      blocks.push(block);
    }
  }
  return blocks;
}

function mapEntries(node: unknown): Pair[] {
  return isMap(node) ? node.items : [];
}

/**
 * A scalar whose source text is its value: plain, or quoted without escapes, on one line.
 * An empty value (`provider: `) is an empty name, for completion.
 */
function textOf(node: unknown, source: string): NameReference | null {
  if (!isScalar(node) || !node.range) {
    return null;
  }
  const [start, end] = node.range;
  const raw = source.slice(start, end);
  if (node.value === null && raw === '') {
    // In a flow map (`{ property:  }`) the empty value sits after the spaces: cover them,
    // except the one separating it from the `:`.
    let nameStart = start;
    while (nameStart > 0 && (source[nameStart - 1] === ' ' || source[nameStart - 1] === '\t')) {
      nameStart--;
    }
    nameStart = nameStart < start ? nameStart + 1 : start;
    return { name: '', start: nameStart, end, nameStart, nameEnd: end };
  }
  const quoted = node.type === 'QUOTE_SINGLE' || node.type === 'QUOTE_DOUBLE';
  if (typeof node.value !== 'string' || raw.includes('\n') || (!quoted && node.type !== 'PLAIN')) {
    return null;
  }
  const content = quoted ? raw.slice(1, -1) : raw;
  if (content !== node.value) {
    return null;
  }
  const nameStart = start + (quoted ? 1 : 0);
  return { name: content, start, end, nameStart, nameEnd: nameStart + content.length };
}

/** The items of a comma-separated string (`'a, b'`), each one trimmed; the whole scalar when there is no comma. */
function splitList(text: NameReference): NameReference[] {
  if (!text.name.includes(',')) {
    return [text];
  }
  const items: NameReference[] = [];
  let offset = text.nameStart;
  for (const segment of text.name.split(',')) {
    const leading = segment.length - segment.trimStart().length;
    const name = segment.trim();
    const nameStart = offset + leading;
    items.push({ name, start: nameStart, end: nameStart + name.length, nameStart, nameEnd: nameStart + name.length });
    offset += segment.length + 1;
  }
  return items;
}

function scalarString(node: unknown): string | null {
  return isScalar(node) && typeof node.value === 'string' ? node.value : null;
}
