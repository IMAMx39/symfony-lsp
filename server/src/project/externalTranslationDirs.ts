import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Parsers } from '../parsing/parsers';
import { bundleRootDir, enabledBundles } from './bundles';
import { ComposerAutoload } from './ComposerAutoload';

/** Components whose translations FrameworkExtension registers, with their directory in the package. */
const COMPONENT_TRANSLATIONS = ['symfony/validator', 'symfony/form', 'symfony/security-core'];

export interface ExternalTranslationDirs {
  /** Existing translation directories of components and enabled bundles. */
  dirs: string[];
  /** False when some of them cannot be located (no installed.json, bundle not found). */
  complete: boolean;
  /** Problems worth logging. */
  warnings: string[];
}

/**
 * Translation directories FrameworkExtension::registerTranslatorConfiguration() scans besides
 * the project ones: validator, form and security-core `Resources/translations`, then each
 * enabled bundle's `Resources/translations` or `translations`. Their files are not parsed: they
 * only tell which domains and locales may hold keys this index does not know.
 */
export function externalTranslationDirs(projectRoot: string, env: string, parsers: Parsers): ExternalTranslationDirs {
  const autoload = ComposerAutoload.load(projectRoot);
  const dirs: string[] = [];
  const warnings: string[] = [];
  let complete = true;
  if (!autoload.hasInstalledPackages) {
    complete = false;
    warnings.push('vendor/composer/installed.json not found: bundle translations are unknown');
  }
  for (const name of COMPONENT_TRANSLATIONS) {
    const dir = autoload.packageDir(name);
    if (dir !== null) {
      dirs.push(path.join(dir, 'Resources', 'translations'));
    }
  }
  const bundlesSource = readText(path.join(projectRoot, 'config', 'bundles.php'));
  for (const className of bundlesSource === null ? [] : enabledBundles(bundlesSource, env, parsers)) {
    const shortName = className.split('\\').pop() ?? className;
    const classFile = autoload.findClassFile(className);
    const source = classFile === null ? null : readText(classFile);
    const root = classFile === null || source === null ? null : bundleRootDir(source, classFile, shortName, parsers);
    if (root === null) {
      complete = false;
      warnings.push(`Cannot locate the translations of ${className}`);
      continue;
    }
    const candidates = [path.join(root, 'Resources', 'translations'), path.join(root, 'translations')];
    const found = candidates.find(isDirectory);
    if (found !== undefined) {
      dirs.push(found);
    }
  }
  return { dirs: dirs.filter(isDirectory), complete, warnings };
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
