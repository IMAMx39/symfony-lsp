import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Location } from 'vscode-languageserver';
import type { Parsers } from '../parsing/parsers';
import { ComposerAutoload } from '../project/ComposerAutoload';
import { locateClass } from '../project/classLocation';
import { findContainerXml, parseContainerXml } from '../services/containerXml';
import type { ServiceInfo } from '../services/types';
import { parseServicesYaml } from '../services/yamlServices';
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

/**
 * Service ids of a project, merged from (lowest to highest priority):
 * 1. the container dumped in debug mode, var/cache/dev/*Container.xml (every service, bundles
 *    and resource-registered classes included, but possibly stale);
 * 2. services declared with an explicit key in config/services.yaml and config/services_dev.yaml
 *    (the files MicroKernelTrait loads). Open documents can override their file (updateYamlFile).
 */
export class ServiceIndex {
  private container: Map<string, ServiceInfo> | null = null;
  private readonly yamlFiles = new Map<string, ServiceInfo[]>();
  private merged: Map<string, ServiceInfo> | null = null;
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
    return this.servicesById().get(id);
  }

  /** Ids worth proposing: hidden ids (starting with `.`) are left out, as debug:container does. */
  visibleServices(): ServiceInfo[] {
    return [...this.servicesById().values()].filter((service) => !service.id.startsWith('.'));
  }

  hasContainer(): boolean {
    return this.container !== null;
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

  reloadContainer(): void {
    const file = findContainerXml(path.join(this.projectRoot, 'var', 'cache', SERVICES_ENV));
    const source = file === null ? null : readText(file);
    const services = source === null ? null : parseContainerXml(source);
    this.container = services === null ? null : new Map(services.map((service) => [service.id, service]));
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
    if (source === null) {
      this.yamlFiles.delete(key);
    } else {
      const services = parseServicesYaml(source, file, SERVICES_ENV);
      if (services !== null) {
        this.yamlFiles.set(key, services);
      }
    }
    this.merged = null;
    return true;
  }

  private servicesById(): Map<string, ServiceInfo> {
    if (this.merged !== null) {
      return this.merged;
    }
    const merged = new Map<string, ServiceInfo>(this.container ?? []);
    // Same order as the kernel: services.yaml, then services_dev.yaml overrides it.
    for (const file of servicesYamlFiles(this.projectRoot)) {
      for (const service of this.yamlFiles.get(pathKey(file)) ?? []) {
        const compiled = merged.get(service.id);
        merged.set(service.id, {
          ...service,
          // A child definition (`parent:`) only gets its class from the compiled container.
          class: service.alias === null ? (service.class ?? compiled?.class ?? null) : null,
        });
      }
    }
    this.merged = merged;
    return merged;
  }
}

/** MicroKernelTrait::configureContainer(): services.yaml, then services_<env>.yaml. */
function servicesYamlFiles(projectRoot: string): string[] {
  const config = path.join(projectRoot, 'config');
  return [path.join(config, 'services.yaml'), path.join(config, `services_${SERVICES_ENV}.yaml`)];
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
