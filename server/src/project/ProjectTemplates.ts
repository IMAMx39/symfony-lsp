import * as path from 'node:path';
import { TemplateIndex } from '../index/TemplateIndex';
import type { Parsers } from '../parsing/parsers';
import { TemplateResolver } from './TemplateResolver';
import { TwigLoaderPaths } from './TwigLoaderPaths';

/** Files whose change alters template loading (configuration, bundles, installed packages). */
const CONFIG_FILES = [/^config\/packages\/.+\.(ya?ml|php)$/, /^config\/bundles\.php$/, /^composer\.json$/, /^vendor\/composer\/installed\.json$/];

/** Everything template-related for one project, rebuilt when its configuration changes. */
export class ProjectTemplates {
  private constructor(
    readonly loaderPaths: TwigLoaderPaths,
    readonly resolver: TemplateResolver,
    readonly index: TemplateIndex,
  ) {}

  static build(projectRoot: string, parsers: Parsers): ProjectTemplates {
    const loaderPaths = TwigLoaderPaths.build(projectRoot, parsers);
    return new ProjectTemplates(
      loaderPaths,
      new TemplateResolver(loaderPaths.namespaces),
      new TemplateIndex(loaderPaths.namespaces),
    );
  }

  static isConfigFile(file: string, projectRoot: string): boolean {
    const relative = path.relative(projectRoot, file).split(path.sep).join('/');
    return CONFIG_FILES.some((pattern) => pattern.test(relative));
  }
}
