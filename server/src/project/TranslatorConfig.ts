import * as fs from 'node:fs';
import * as path from 'node:path';
import { isRecord, readPackageConfigs, resolveConfigPath } from './packageConfig';

/** FrameworkBundle's defaults (Configuration: default_locale, translator.default_path). */
const DEFAULT_LOCALE = 'en';
const DEFAULT_PATH = '%kernel.project_dir%/translations';

/**
 * The `framework` configuration relevant to translations, merged like TwigConfig from the YAML
 * files of config/packages/ (then <env>/, each followed by `when@<env>`). PHP files are not read.
 */
export class TranslatorConfig {
  private constructor(
    readonly defaultLocale: string,
    /**
     * Directories of the project scanned for translation files, from the lowest to the highest
     * priority (FrameworkExtension: translator.paths, then default_path). Bundle and component
     * directories are not read.
     */
    readonly dirs: readonly string[],
    /** Problems worth logging (unreadable files, unresolved parameters). */
    readonly warnings: readonly string[],
  ) {}

  static load(projectRoot: string, env: string): TranslatorConfig {
    const warnings: string[] = [];
    let defaultLocale = DEFAULT_LOCALE;
    let enabled = true;
    let defaultPath: unknown = DEFAULT_PATH;
    let paths: unknown[] = [];

    const packagesDir = path.join(projectRoot, 'config', 'packages');
    for (const name of ['framework.php', 'translation.php']) {
      for (const phpConfig of [path.join(packagesDir, name), path.join(packagesDir, env, name)]) {
        if (fs.existsSync(phpConfig)) {
          warnings.push(`${phpConfig} is not read: PHP configuration requires running PHP`);
        }
      }
    }
    const configs = readPackageConfigs(projectRoot, env);
    for (const { file, message } of configs.invalid) {
      warnings.push(`Cannot parse ${file}: ${message}`);
    }
    for (const { content } of configs.blocks) {
      const framework = content['framework'];
      if (!isRecord(framework)) {
        continue;
      }
      if (typeof framework['default_locale'] === 'string' && framework['default_locale'] !== '') {
        defaultLocale = framework['default_locale'];
      }
      const translator = framework['translator'];
      if (typeof translator === 'boolean') {
        enabled = translator;
      } else if (isRecord(translator)) {
        if (typeof translator['enabled'] === 'boolean') {
          enabled = translator['enabled'];
        }
        if ('default_path' in translator) {
          defaultPath = translator['default_path'];
        }
        if (Array.isArray(translator['paths'])) {
          // Lists are appended across files by the config component.
          paths = [...paths, ...translator['paths']];
        }
      }
    }

    const dirs: string[] = [];
    if (enabled) {
      for (const rawPath of [...paths, defaultPath]) {
        if (rawPath === null) {
          continue;
        }
        const dir = resolveConfigPath(rawPath, projectRoot);
        if (dir === null) {
          warnings.push(`Unresolved translator path ${String(rawPath)}`);
        } else if (!dirs.includes(dir)) {
          dirs.push(dir);
        }
      }
    }
    return new TranslatorConfig(defaultLocale, dirs, warnings);
  }
}
