import * as path from 'node:path';
import type { TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { beforeAll, describe, expect, it } from 'vitest';
import { AutowireReferenceFinder } from '../../../src/features/services/AutowireReferenceFinder';
import { provideEnvCompletion } from '../../../src/features/services/envCompletion';
import type { EnvVariable } from '../../../src/index/EnvIndex';
import type { Parsers } from '../../../src/parsing/parsers';
import type { EnvReference } from '../../../src/services/envPlaceholders';
import type { ParameterInfo } from '../../../src/services/types';
import { findYamlEnvReferences, findYamlParameterReferences } from '../../../src/services/yamlParameterReferences';
import { pathToUri } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const VARIABLES: EnvVariable[] = [
  { name: 'APP_SECRET', value: 'abc', file: '.env' },
  { name: 'DATABASE_URL', value: 'mysql://db', file: '.env' },
];
const PARAMETERS: ParameterInfo[] = [
  { name: 'env(DEFAULTED)', value: 'fallback', location: null },
  { name: 'env(APP_SECRET)', value: 'ignored', location: null },
  { name: 'app.sender', value: 'x', location: null },
];

describe('env completion', () => {
  let parsers: Parsers;

  beforeAll(async () => {
    parsers = await loadParsers();
  });

  function completeIn(document: TextDocument, offset: number, references: EnvReference[]) {
    const items = provideEnvCompletion(document, document.positionAt(offset), references, VARIABLES, PARAMETERS);
    const apply = (label: string): string => {
      const edit = items?.find((item) => item.label === label)?.textEdit as TextEdit;
      const text = document.getText();
      return text.slice(0, document.offsetAt(edit.range.start)) + edit.newText + text.slice(document.offsetAt(edit.range.end));
    };
    return { labels: items?.map((item) => item.label) ?? null, apply };
  }

  function yaml(source: string) {
    const { document, offset } = withCursor(pathToUri(path.join(fixtureApp, 'config', 'packages', 'test.yaml')), 'yaml', source);
    return completeIn(document, offset, findYamlEnvReferences(document.getText(), 'all'));
  }

  function php(source: string) {
    const { document, offset } = withCursor(pathToUri(path.join(fixtureApp, 'src', 'Service', 'Test.php')), 'php', source);
    const tree = parsers.parse('php', document.getText())!;
    const references = new AutowireReferenceFinder(parsers).find(tree.rootNode).env;
    tree.delete();
    return completeIn(document, offset, references);
  }

  it('proposes variables and processors right after %env(, and closes the placeholder', () => {
    const { labels, apply } = yaml("doctrine:\n    url: '%env(|'\n");
    expect(labels?.slice(0, 3)).toEqual(['APP_SECRET', 'DATABASE_URL', 'DEFAULTED']);
    expect(labels).toContain('json:');
    expect(labels).not.toContain('app.sender');
    expect(apply('DATABASE_URL')).toBe("doctrine:\n    url: '%env(DATABASE_URL)%'\n");
    expect(apply('int:')).toBe("doctrine:\n    url: '%env(int:'\n");
  });

  it('replaces the segment under the cursor and appends only what is missing', () => {
    expect(yaml("a: '%env(int:DATA|BASE_URL)%'\n").apply('APP_SECRET')).toBe("a: '%env(int:APP_SECRET)%'\n");
    expect(yaml("a: '%env(DATA|)'\n").apply('DATABASE_URL')).toBe("a: '%env(DATABASE_URL)%'\n");
    expect(yaml("a: '%env(js|:DATABASE_URL)%'\n").apply('json:')).toBe("a: '%env(json:DATABASE_URL)%'\n");
    expect(yaml("a: '%env(js|:DATABASE_URL)%'\n").labels).not.toContain('DATABASE_URL');
  });

  it('skips the argument of default, key and enum', () => {
    expect(yaml("a: '%env(default:|:APP_SECRET)%'\n").labels).toBeNull();
    expect(yaml("a: '%env(key:pa|th:json:APP_SECRET)%'\n").labels).toBeNull();
    expect(yaml("a: '%env(key:path:js|on:APP_SECRET)%'\n").labels).toContain('json:');
    expect(yaml("a: '%env(default:fallback:|)%'\n").labels).toContain('APP_SECRET');
  });

  it('completes #[Autowire(env:)] and env placeholders of #[Autowire] values', () => {
    const prelude = '<?php\nuse Symfony\\Component\\DependencyInjection\\Attribute\\Autowire;\nclass T { public function __construct(';
    expect(php(`${prelude}#[Autowire(env: 'APP|')] string $s) {} }`).apply('APP_SECRET')).toContain(`env: 'APP_SECRET'`);
    expect(php(`${prelude}#[Autowire('%env(bool:|)%')] bool $b) {} }`).labels).toContain('DATABASE_URL');
  });

  it('keeps env placeholders out of parameter references, and proposes nothing elsewhere', () => {
    expect(findYamlParameterReferences("a: '%env(APP_SECRET)% %app.sender%'\n", 'all').map((reference) => reference.name)).toEqual(['app.sender']);
    expect(yaml("a: '%app.|'\n").labels).toBeNull();
    expect(yaml("a: 'env(|'\n").labels).toBeNull();
  });
});
