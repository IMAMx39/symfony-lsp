import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseDocument } from 'yaml';

/** A top-level mapping of a config/packages YAML file (the file itself or its `when@<env>` block). */
export interface PackageConfigBlock {
  file: string;
  content: Record<string, unknown>;
}

export interface PackageConfigs {
  /**
   * In the order MicroKernelTrait loads them: the YAML files of config/packages/ then
   * config/packages/<env>/ (sorted by name), each followed by its `when@<env>` block.
   */
  blocks: PackageConfigBlock[];
  /** Files that are not valid YAML, with the first error. */
  invalid: Array<{ file: string; message: string }>;
}

/** Reads the YAML configuration of config/packages for an environment. PHP files are not read. */
export function readPackageConfigs(projectRoot: string, env: string): PackageConfigs {
  const packagesDir = path.join(projectRoot, 'config', 'packages');
  const blocks: PackageConfigBlock[] = [];
  const invalid: Array<{ file: string; message: string }> = [];
  for (const file of [...yamlFiles(packagesDir), ...yamlFiles(path.join(packagesDir, env))]) {
    let source: string;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch (error) {
      invalid.push({ file, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const document = parseDocument(source);
    if (document.errors.length > 0) {
      invalid.push({ file, message: document.errors[0]?.message ?? 'unknown error' });
      continue;
    }
    const content: unknown = document.toJS();
    if (!isRecord(content)) {
      continue;
    }
    blocks.push({ file, content });
    const envBlock = content[`when@${env}`];
    if (isRecord(envBlock)) {
      blocks.push({ file, content: envBlock });
    }
  }
  return { blocks, invalid };
}

/**
 * Resolves %kernel.project_dir%; relative paths are relative to the project root.
 * Any other parameter cannot be resolved statically: null.
 */
export function resolveConfigPath(value: unknown, projectRoot: string): string | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const replaced = value.replace(/%kernel\.project_dir%/g, projectRoot);
  return /%[^%]+%/.test(replaced) ? null : path.resolve(projectRoot, replaced);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function yamlFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}
