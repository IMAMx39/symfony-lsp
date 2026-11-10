import * as fs from 'node:fs';
import * as path from 'node:path';
import { serviceFileKind } from '../index/ServiceIndex';
import { hasImports, parseSecurityProviders, providerKey, type ProviderDeclaration } from '../security/securityYaml';
import { pathKey } from '../util/paths';

/** Environment whose configuration is reproduced. */
export const SECURITY_ENV = 'dev';

interface SecurityFile {
  file: string;
  providers: ProviderDeclaration[];
  hasImports: boolean;
}

/**
 * SecurityBundle configuration read from the YAML files MicroKernelTrait loads: config/packages/,
 * config/packages/<env>/, then config/services.yaml and services_<env>.yaml (any of them may
 * hold a `security:` block), each with its `when@<env>` block. PHP files are not read.
 * Open documents override their file (updateFile).
 */
export class SecurityConfig {
  private readonly files = new Map<string, SecurityFile>();
  /** Keys of the files whose current content is not valid YAML. */
  private readonly invalid = new Set<string>();

  constructor(private readonly projectRoot: string) {
    for (const file of configFiles(projectRoot)) {
      this.updateFile(file, null);
    }
  }

  /** True for the YAML files this configuration is read from. */
  static isConfigFile(file: string, projectRoot: string): boolean {
    const relative = path.relative(projectRoot, file).split(path.sep).join('/');
    return new RegExp(`^config/packages/(${SECURITY_ENV}/)?[^/]+\\.ya?ml$`).test(relative) || serviceFileKind(file, projectRoot) === 'services-config';
  }

  /** Every declared user provider, in loading order (a later declaration of a name merges into the first). */
  providers(): ProviderDeclaration[] {
    return configFiles(this.projectRoot).flatMap((file) => this.files.get(pathKey(file))?.providers ?? []);
  }

  /** First declaration of a provider, names compared leniently (providerKey). */
  findProvider(name: string): ProviderDeclaration | undefined {
    const key = providerKey(name);
    return this.providers().find((provider) => providerKey(provider.name) === key);
  }

  /**
   * True when every provider of the configuration is known: no PHP configuration in
   * config/packages (nor config/services.php in place of services.yaml), every YAML file valid
   * and without `imports:`. Bundles prepending security configuration are not detected.
   */
  isCertain(): boolean {
    if (this.invalid.size > 0 || [...this.files.values()].some((file) => file.hasImports)) {
      return false;
    }
    const config = path.join(this.projectRoot, 'config');
    if (!fs.existsSync(path.join(config, 'services.yaml')) && fs.existsSync(path.join(config, 'services.php'))) {
      return false;
    }
    const packages = path.join(config, 'packages');
    return ![packages, path.join(packages, SECURITY_ENV)].some((dir) => listFiles(dir).some((name) => name.endsWith('.php')));
  }

  /**
   * Re-reads a configuration file from `content` (open document) or from disk when null.
   * Invalid YAML keeps the previous declarations (file being edited).
   * Returns true when the file is one this configuration is read from.
   */
  updateFile(file: string, content: string | null): boolean {
    if (!SecurityConfig.isConfigFile(file, this.projectRoot)) {
      return false;
    }
    const key = pathKey(file);
    const source = content ?? readText(file);
    this.invalid.delete(key);
    if (source === null) {
      this.files.delete(key);
      return true;
    }
    const providers = parseSecurityProviders(source, file, SECURITY_ENV);
    if (providers === null) {
      this.invalid.add(key);
    } else {
      this.files.set(key, { file, providers, hasImports: hasImports(source, SECURITY_ENV) });
    }
    return true;
  }
}

/** In MicroKernelTrait order: config/packages/*, config/packages/<env>/* (sorted), services.yaml, services_<env>.yaml. */
function configFiles(projectRoot: string): string[] {
  const config = path.join(projectRoot, 'config');
  const packages = path.join(config, 'packages');
  const yaml = (dir: string): string[] =>
    listFiles(dir)
      .filter((name) => /\.ya?ml$/.test(name))
      .sort()
      .map((name) => path.join(dir, name));
  return [...yaml(packages), ...yaml(path.join(packages, SECURITY_ENV)), path.join(config, 'services.yaml'), path.join(config, `services_${SECURITY_ENV}.yaml`)];
}

function listFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
