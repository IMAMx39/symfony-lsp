import * as path from 'node:path';
import type { TextEdit } from 'vscode-languageserver';
import { beforeAll, describe, expect, it } from 'vitest';
import { provideParameterCompletion } from '../../src/features/services/completion';
import { provideParameterDefinition } from '../../src/features/services/definition';
import { ServiceIndex } from '../../src/index/ServiceIndex';
import { findYamlParameterReferences, type YamlParameterScope } from '../../src/services/yamlParameterReferences';
import { isSamePath, pathToUri, uriToPath } from '../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../helpers';

const names = (source: string, scope: YamlParameterScope = 'all'): string[] =>
  findYamlParameterReferences(source, scope).map((reference) => source.slice(reference.start, reference.end));

describe('findYamlParameterReferences', () => {
  it('finds placeholders in values at any depth, quoted or plain', () => {
    const source = [
      'twig:',
      "    default_path: '%kernel.project_dir%/templates'",
      '    globals:',
      '        sender: "%app.sender%"',
      "        both: '%a%-%b%'",
      '    list: [x, "%c%"]',
      '    plain: foo %d%',
      '',
    ].join('\n');
    expect(names(source)).toEqual(['%kernel.project_dir%', '%app.sender%', '%a%', '%b%', '%c%', '%d%']);
  });

  it('skips keys, escaped percents, env placeholders, escapes and block scalars', () => {
    const source = [
      "'%key%': x",
      "a: '100%% sure'",
      "b: '%env(APP_SECRET)%'",
      'c: "%e%\\t"',
      "d: 'it''s %f%'",
      'e: |',
      '    %g%',
      '',
    ].join('\n');
    expect(names(source)).toEqual([]);
  });

  it('reports a trailing placeholder being typed as not closed', () => {
    const [reference] = findYamlParameterReferences("a: '%kernel.pro'\n", 'all');
    expect(reference).toMatchObject({ name: 'kernel.pro', closed: false });
  });

  it('only reads the route keys the Router resolves', () => {
    const source = [
      'blog:',
      "    path: '/%app.prefix%/blog'",
      "    controller: '%app.controller%'",
      "    defaults: { _locale: '%locale%' }",
      "    requirements: { id: '%id_regex%' }",
      "    options: { x: '%not_resolved%' }",
      'when@dev:',
      '    debug:',
      "        host: '%app.host%'",
      'admin:',
      "    resource: '%kernel.project_dir%/src/Admin/'",
      "    prefix: '/%admin.prefix%'",
      '',
    ].join('\n');
    expect(names(source, 'routes')).toEqual(['%app.prefix%', '%app.controller%', '%locale%', '%id_regex%', '%app.host%', '%admin.prefix%']);
  });
});

describe('YAML parameter definition and completion', () => {
  let index: ServiceIndex;

  beforeAll(async () => {
    index = new ServiceIndex(fixtureApp, await loadParsers());
  });

  const at = (source: string) => {
    const { document, offset } = withCursor(pathToUri(path.join(fixtureApp, 'config', 'packages', 'test.yaml')), 'yaml', source);
    return { document, position: document.positionAt(offset), references: findYamlParameterReferences(document.getText(), 'all') };
  };

  it('goes to the parameters: key of services.yaml', () => {
    const { document, position, references } = at("mailer:\n    sender: '%app.sen|der%'\n");
    const location = provideParameterDefinition(document, position, references, index);
    expect(location && isSamePath(uriToPath(location.uri), path.join(fixtureApp, 'config', 'services.yaml'))).toBe(true);
    expect(location?.range.start.line).toBe(1);
  });

  it('has no target for a parameter only known from the container', () => {
    const { document, position, references } = at("twig:\n    default_path: '%kernel.project|_dir%/templates'\n");
    expect(provideParameterDefinition(document, position, references, index)).toBeNull();
  });

  it('completes parameter names and closes the placeholder', () => {
    const { document, position, references } = at("twig:\n    default_path: '%kernel.|'\n");
    const items = provideParameterCompletion(document, position, references, index.visibleParameters());
    expect(items?.map((item) => item.label)).toContain('kernel.project_dir');
    expect(items?.map((item) => item.label)).not.toContain('.kernel.bundles_definition');
    const edit = items?.find((item) => item.label === 'kernel.project_dir')?.textEdit as TextEdit;
    expect(edit.newText).toBe('kernel.project_dir%');
  });
});
