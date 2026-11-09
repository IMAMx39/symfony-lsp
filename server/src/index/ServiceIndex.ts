import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Location } from 'vscode-languageserver';
import type { Parsers } from '../parsing/parsers';
import { ComposerAutoload } from '../project/ComposerAutoload';
import { locateClass } from '../project/classLocation';
import { findContainerXml, parseContainerXml } from '../services/containerXml';
import type { ParameterInfo, ServiceInfo, ServiceTag } from '../services/types';
import { parseServicesYaml, type ServicesYamlFile } from '../services/yamlServices';
import { isSamePath, pathKey } from '../util/paths';

/** Environment whose container is mirrored (the one developers run). */
export const SERVICES_ENV = 'dev';

const MAX_ALIAS_DEPTH = 16;

/** What a changed file means for the services of a project. */
export type ServiceFileKind = 'services-config' | 'container' | null;

export function serviceFileKind(file: string, projectRoot: string): ServiceFileKind {
  if (servicesYamlFiles(projectRoot).some((candidate) => isSamePath(candidate, file))) {
    return 'services-config';
  }
  const relative = path.relative(projectRoot, file).split(path.sep).join('/');
  return new RegExp(`^var/cache/${SERVICES_ENV}/[^/]+Container\\.xml$`).test(relative) ? 'container' : null;
}

interface ContainerData {
  services: Map<string, ServiceInfo>;
  parameters: Map<string, ParameterInfo>;
}

/**
 * Service ids and parameters of a project, merged from (lowest to highest priority):
 * 1. the container dumped in debug mode, var/cache/dev/*Container.xml (every service, bundles
 *    and resource-registered classes included, but possibly stale);
 * 2. services declared with an explicit key, and parameters, in config/services.yaml and
 *    config/services_dev.yaml (the files MicroKernelTrait loads). Open documents can override
 *    their file (updateYamlFile).
 */
export class ServiceIndex {
  private container: ContainerData | null = null;
  private containerFile: string | null = null;
  private readonly yamlFiles = new Map<string, ServicesYamlFile>();
  /** Keys of the services YAML files whose current content is not valid YAML. */
  private readonly invalidYaml = new Set<string>();
  private merged: ContainerData | null = null;
  private autoload: ComposerAutoload;

  constructor(
    private readonly projectRoot: string,
    private readonly parsers: Parsers,
  ) {
    this.autoload = ComposerAutoload.load(projectRoot);
    this.reloadContainer();
    for (const file of servicesYamlFiles(projectRoot)) {
      this.updateYamlFile(file, null);
    }
  }

  get(id: string): ServiceInfo | undefined {
    return this.data().services.get(id);
  }

  /** Ids worth proposing: hidden ids (starting with `.`) are left out, as debug:container does. */
  visibleServices(): ServiceInfo[] {
    return [...this.data().services.values()].filter((service) => !service.id.startsWith('.'));
  }

  getParameter(name: string): ParameterInfo | undefined {
    return this.data().parameters.get(name);
  }

  /** Parameters worth proposing: hidden ones (`.kernel.bundles_definition`…) are left out. */
  visibleParameters(): ParameterInfo[] {
    return [...this.data().parameters.values()].filter((parameter) => !parameter.name.startsWith('.'));
  }

  hasContainer(): boolean {
    return this.container !== null;
  }

  /** Service an alias chain ends on (the service itself when it is not an alias). */
  resolve(service: ServiceInfo): ServiceInfo | undefined {
    let current: ServiceInfo | undefined = service;
    for (let depth = 0; current !== undefined && depth < MAX_ALIAS_DEPTH; depth++) {
      if (current.alias === null) {
        return current;
      }
      current = this.get(current.alias);
    }
    return undefined;
  }

  /** Services (not aliases) carrying a tag, with each application of it, hidden ids included. */
  taggedWith(tagName: string): Array<{ service: ServiceInfo; tags: ServiceTag[] }> {
    const tagged: Array<{ service: ServiceInfo; tags: ServiceTag[] }> = [];
    for (const service of this.data().services.values()) {
      const tags = service.alias === null ? service.tagEntries.filter((tag) => tag.name === tagName) : [];
      if (tags.length > 0) {
        tagged.push({ service, tags });
      }
    }
    return tagged;
  }

  /** Visible aliases pointing directly to a service id. */
  aliasesOf(id: string): ServiceInfo[] {
    return this.visibleServices().filter((service) => service.alias === id);
  }

  /** Declaration of a class, interface, trait or enum, found through PSR-4. */
  classLocation(className: string): Location | null {
    return locateClass(this.autoload, this.parsers, className);
  }

  /** Declaration of the service (YAML key), else the class it resolves to, following aliases. */
  locationOf(service: ServiceInfo): Location | null {
    let current: ServiceInfo | undefined = service;
    for (let depth = 0; current !== undefined && depth < MAX_ALIAS_DEPTH; depth++) {
      if (current.location) {
        return current.location;
      }
      if (current.alias === null) {
        return current.class === null ? null : locateClass(this.autoload, this.parsers, current.class);
      }
      current = this.get(current.alias);
    }
    return null;
  }

  /**
   * True when an id missing from the index is really unknown to the container: the dump exists
   * and is newer than the configuration it was compiled from (config/packages, bundles, Composer
   * autoload), config/services.yaml is used (not services.php), and every services YAML file is
   * valid and imports nothing. Classes added since the dump are covered by mayBeAutoregistered().
   */
  isCertain(): boolean {
    const dumpedAt = this.containerFile === null ? null : modificationTime(this.containerFile);
    const [mainYaml] = servicesYamlFiles(this.projectRoot);
    if (this.container === null || dumpedAt === null || mainYaml === undefined || modificationTime(mainYaml) === null) {
      return false;
    }
    if (this.invalidYaml.size > 0 || [...this.yamlFiles.values()].some((file) => file.hasImports)) {
      return false;
    }
    return compiledInputs(this.projectRoot).every((file) => (modificationTime(file) ?? 0) <= dumpedAt);
  }

  /**
   * True when the id names a class that exists through PSR-4: it may be registered by a
   * `resource:` prototype after the last dump.
   */
  mayBeAutoregistered(id: string): boolean {
    return id.includes('\\') && this.autoload.findClassFile(id) !== null;
  }

  reloadContainer(): void {
    const file = findContainerXml(path.join(this.projectRoot, 'var', 'cache', SERVICES_ENV));
    const source = file === null ? null : readText(file);
    const dumped = source === null ? null : parseContainerXml(source);
    this.containerFile = dumped === null ? null : file;
    this.container =
      dumped === null
        ? null
        : {
            services: new Map(dumped.services.map((service) => [service.id, service])),
            parameters: new Map(dumped.parameters.map((parameter) => [parameter.name, parameter])),
          };
    this.merged = null;
  }

  /** Composer autoload changed: class files may have moved. */
  reloadAutoload(): void {
    this.autoload = ComposerAutoload.load(this.projectRoot);
  }

  /**
   * Re-reads the services declared in a services YAML file, from `content` (open document) or
   * from disk when null. Invalid YAML keeps the previous declarations (file being edited).
   * Returns true when the file is a services file of the project.
   */
  updateYamlFile(file: string, content: string | null): boolean {
    if (serviceFileKind(file, this.projectRoot) !== 'services-config') {
      return false;
    }
    const key = pathKey(file);
    const source = content ?? readText(file);
    this.invalidYaml.delete(key);
    if (source === null) {
      this.yamlFiles.delete(key);
    } else {
      const parsed = parseServicesYaml(source, file, SERVICES_ENV);
      if (parsed === null) {
        this.invalidYaml.add(key);
      } else {
        this.yamlFiles.set(key, parsed);
      }
    }
    this.merged = null;
    return true;
  }

  private data(): ContainerData {
    if (this.merged !== null) {
      return this.merged;
    }
    const services = new Map<string, ServiceInfo>(this.container?.services ?? []);
    const parameters = new Map<string, ParameterInfo>(this.container?.parameters ?? []);
    // Same order as the kernel: services.yaml, then services_dev.yaml overrides it.
    for (const file of servicesYamlFiles(this.projectRoot)) {
      const parsed = this.yamlFiles.get(pathKey(file));
      for (const parameter of parsed?.parameters ?? []) {
        // The compiled value is the resolved one (placeholders, env overrides): keep it.
        parameters.set(parameter.name, { ...parameter, value: parameters.get(parameter.name)?.value ?? parameter.value });
      }
      for (const service of parsed?.services ?? []) {
        const compiled = services.get(service.id);
        services.set(service.id, {
          ...service,
          // A child definition (`parent:`) only gets its class from the compiled container.
          class: service.alias === null ? (service.class ?? compiled?.class ?? null) : null,
          // Compiled tags include autoconfigured ones; YAML ones may be newer than the dump.
          tags: service.alias === null ? [...new Set([...(compiled?.tags ?? []), ...service.tags])] : [],
          tagEntries: service.alias === null ? uniqueTags([...(compiled?.tagEntries ?? []), ...service.tagEntries]) : [],
        });
      }
    }
    this.merged = { services, parameters };
    return this.merged;
  }
}

/** Tag applications without duplicates (the same tag from the dump and from the YAML). */
function uniqueTags(tags: readonly ServiceTag[]): ServiceTag[] {
  const byKey = new Map<string, ServiceTag>();
  for (const tag of tags) {
    const key = JSON.stringify([tag.name, Object.entries(tag.attributes).sort(([a], [b]) => a.localeCompare(b))]);
    if (!byKey.has(key)) {
      byKey.set(key, tag);
    }
  }
  return [...byKey.values()];
}

/** MicroKernelTrait::configureContainer(): services.yaml, then services_<env>.yaml. */
function servicesYamlFiles(projectRoot: string): string[] {
  const config = path.join(projectRoot, 'config');
  return [path.join(config, 'services.yaml'), path.join(config, `services_${SERVICES_ENV}.yaml`)];
}

/** Files whose change makes the compiled container stale (services YAML files are read directly). */
function compiledInputs(projectRoot: string): string[] {
  const files = [
    path.join(projectRoot, 'composer.json'),
    path.join(projectRoot, 'vendor', 'composer', 'installed.json'),
    path.join(projectRoot, 'config', 'bundles.php'),
  ];
  const pending = [path.join(projectRoot, 'config', 'packages')];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  return files;
}

function modificationTime(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
