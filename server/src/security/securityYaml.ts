import { Location, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { isMap, isScalar, isSeq, parseDocument, type Document, type Pair, type YAMLMap } from 'yaml';
import type { ClassReference, ServiceReference } from '../services/yamlServices';
import { pathToUri } from '../util/paths';

/** Same shape as the class names ResolveClassPass accepts as a service id (namespaced only). */
const NAMESPACED_CLASS = /^[A-Za-z_\x7f-\uffff][\w\x7f-\uffff]*(?:\\[A-Za-z_\x7f-\uffff][\w\x7f-\uffff]*)+$/;

/** Firewall options holding a service id (SecurityExtension: `new Reference()` / alias / ChildDefinition). */
const FIREWALL_SERVICE_KEYS = ['user_checker', 'access_denied_handler'];
/** Options of an authenticator block (AbstractFactory) holding a service id used as a parent definition. */
const AUTHENTICATOR_SERVICE_KEYS = ['success_handler', 'failure_handler'];
/** Options of an authenticator block read through HttpUtils (generateUri / checkRequestPath): a path or a route name. */
const AUTHENTICATOR_ROUTE_OR_PATH_KEYS = ['login_path', 'check_path', 'default_target_path', 'failure_path'];
/** Options holding a route name only, by block: passed to UrlGenerator::generate(). */
const ROUTE_ONLY_KEYS: Readonly<Record<string, string>> = { login_link: 'check_route', switch_user: 'target_route' };
/** An absolute URL, which HttpUtils::generateUri() returns as is (`parse_url()` gives a scheme and a host). */
const ABSOLUTE_URL = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]/;

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

/** A role of `role_hierarchy` and the roles it includes directly. */
export interface RoleDeclaration {
  role: string;
  includes: string[];
  location: Location;
}

/** What a YAML file declares in its `security:` blocks. */
export interface SecurityDeclarations {
  providers: ProviderDeclaration[];
  /** `role_hierarchy` entries, in document order. */
  roleHierarchy: RoleDeclaration[];
  /** Every role name the file uses: hierarchy keys and values, access_control, memory users, switch_user. */
  roles: string[];
}

/** A role name. Hierarchy keys are declarations; security attributes are accepted where `attributes` is true. */
export interface RoleReference extends NameReference {
  declaration: boolean;
  /** The value is checked through isGranted() (access_control, switch_user): AuthenticatedVoter attributes are valid. */
  attributes: boolean;
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
  /**
   * Route names: `access_control[].route`, `login_link.check_route`, `switch_user.target_route`, and the
   * values HttpUtils reads as a route when they are neither a path (`/...`) nor an absolute URL:
   * `login_path`, `check_path`, `default_target_path`, `failure_path` of an authenticator,
   * `logout.path`, `logout.target`, `access_denied_url`. Values with a `%parameter%` are skipped.
   */
  routes: NameReference[];
  /** Role names: `role_hierarchy` keys and values, `access_control[].roles`, `switch_user.role`, roles of memory users. */
  roles: RoleReference[];
}

/** Attributes of AuthenticatedVoter, valid wherever roles are checked through isGranted(). */
export const SECURITY_ATTRIBUTES: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'PUBLIC_ACCESS', description: 'Everyone, authenticated or not' },
  { name: 'IS_AUTHENTICATED', description: 'Any authenticated user' },
  { name: 'IS_AUTHENTICATED_FULLY', description: 'Authenticated during this session (not remembered)' },
  { name: 'IS_AUTHENTICATED_REMEMBERED', description: 'Authenticated, possibly through a remember-me cookie' },
  { name: 'IS_REMEMBERED', description: 'Authenticated through a remember-me cookie' },
  { name: 'IS_IMPERSONATOR', description: 'Impersonating another user (switch_user)' },
];

/**
 * Providers, role hierarchy and roles declared in the `security:` blocks of a YAML configuration
 * file (the root one and the one of `when@<env>`). Returns null when the file is not valid YAML.
 */
export function parseSecurityDeclarations(source: string, file: string, env: string): SecurityDeclarations | null {
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    return null;
  }
  const text = TextDocument.create(pathToUri(file), 'yaml', 0, source);
  const keyLocation = (pair: Pair): Location | null => {
    const range = (pair.key as { range?: [number, number, number] } | null)?.range;
    return range ? Location.create(text.uri, Range.create(text.positionAt(range[0]), text.positionAt(range[1]))) : null;
  };
  const declarations: SecurityDeclarations = { providers: [], roleHierarchy: [], roles: [] };
  for (const security of securityBlocks(document, env)) {
    for (const pair of mapEntries(security.get('role_hierarchy', true))) {
      const role = scalarString(pair.key);
      const location = keyLocation(pair);
      if (role !== null && location !== null) {
        declarations.roleHierarchy.push({ role, includes: listValues(pair.value), location });
      }
    }
    for (const pair of mapEntries(security.get('providers', true))) {
      const name = scalarString(pair.key);
      const location = keyLocation(pair);
      if (name === null || location === null) {
        continue;
      }
      const definition = isMap(pair.value) ? pair.value : null;
      const type = definition?.items.map((item) => scalarString(item.key)).find((key) => key !== null) ?? null;
      const entity = definition?.get('entity', true);
      const entityClass = isMap(entity) ? scalarString(entity.get('class', true)) : null;
      declarations.providers.push({
        name,
        type,
        entityClass: entityClass === null ? null : entityClass.replace(/^\\/, ''),
        serviceId: definition ? scalarString(definition.get('id', true)) : null,
        location,
      });
    }
  }
  const roles = new Set(findSecurityReferences(source, env).roles.map((reference) => reference.name));
  declarations.roleHierarchy.forEach((entry) => entry.includes.forEach((role) => roles.add(role)));
  roles.delete('');
  declarations.roles = [...roles];
  return declarations;
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
  const references: SecurityReferences = { providers: [], services: [], classes: [], entityProperties: [], routes: [], roles: [] };
  // A sequence of roles, or a string split on commas (preg_split() in the configuration tree).
  const addRoles = (node: unknown, attributes: boolean): void => {
    const texts = isSeq(node) ? node.items.map((item) => textOf(item, source)) : [textOf(node, source)].flatMap((text) => (text === null ? [] : splitList(text)));
    for (const text of texts) {
      if (text !== null) {
        references.roles.push({ ...text, declaration: false, attributes });
      }
    }
  };
  const addRoute = (node: unknown, pathAllowed: boolean): void => {
    const text = textOf(node, source);
    if (text === null || text.name.includes('%') || (pathAllowed && (text.name.startsWith('/') || ABSOLUTE_URL.test(text.name)))) {
      return;
    }
    references.routes.push(text);
  };
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
    for (const pair of mapEntries(security.get('role_hierarchy', true))) {
      const key = textOf(pair.key, source);
      if (key !== null && key.name !== '') {
        references.roles.push({ ...key, declaration: true, attributes: false });
      }
      addRoles(pair.value, false);
    }

    for (const pair of mapEntries(security.get('providers', true))) {
      if (!isMap(pair.value)) {
        continue;
      }
      addService(pair.value.get('id', true), false);
      const memory = pair.value.get('memory', true);
      const users = isMap(memory) ? memory.get('users', true) : null;
      for (const user of mapEntries(users)) {
        if (isMap(user.value)) {
          addRoles(user.value.get('roles', true), false);
        }
      }
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
      addRoute(options.get('access_denied_url', true), true);
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
          const blockOptions = block.value;
          AUTHENTICATOR_SERVICE_KEYS.forEach((key) => addService(blockOptions.get(key, true), false));
          const blockName = scalarString(block.key);
          if (blockName === 'logout') {
            ['path', 'target'].forEach((key) => addRoute(blockOptions.get(key, true), true));
          } else {
            AUTHENTICATOR_ROUTE_OR_PATH_KEYS.forEach((key) => addRoute(blockOptions.get(key, true), true));
          }
          const routeOnly = blockName === null ? undefined : ROUTE_ONLY_KEYS[blockName];
          if (routeOnly !== undefined) {
            addRoute(blockOptions.get(routeOnly, true), false);
          }
          if (blockName === 'switch_user') {
            // A single attribute checked with isGranted() (SwitchUserListener), not split.
            const role = textOf(blockOptions.get('role', true), source);
            if (role !== null) {
              references.roles.push({ ...role, declaration: false, attributes: true });
            }
          }
        }
      }
    }

    const accessControl = security.get('access_control', true);
    if (isSeq(accessControl)) {
      for (const rule of accessControl.items) {
        if (isMap(rule)) {
          // RequestMatcher on the `_route` attribute (SecurityExtension::createAuthorization()).
          addRoute(rule.get('route', true), false);
          addRoles(rule.get('roles', true), true);
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

/** String values of a sequence, or of a string split on commas; empty items dropped. */
function listValues(node: unknown): string[] {
  const values = isSeq(node) ? node.items.map(scalarString) : (scalarString(node)?.split(',') ?? []);
  return values.flatMap((value) => (value === null || value.trim() === '' ? [] : [value.trim()]));
}

function scalarString(node: unknown): string | null {
  return isScalar(node) && typeof node.value === 'string' ? node.value : null;
}
