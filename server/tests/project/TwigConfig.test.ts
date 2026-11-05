import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TwigConfig } from '../../src/project/TwigConfig';

describe('TwigConfig', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'symfony-zed-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function write(relative: string, content: string): void {
    const file = path.join(tmp, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }

  it('defaults to templates/ without configuration', () => {
    const config = TwigConfig.load(tmp, 'dev');
    expect(config.defaultPath).toBe(path.join(tmp, 'templates'));
    expect(config.paths).toEqual([]);
  });

  it('accepts the map and list forms of twig.paths', () => {
    write(
      'config/packages/twig.yaml',
      ['twig:', '    paths:', "        'a/templates': ~", "        'b/templates': B", "        'c/templates': ''", ''].join('\n'),
    );
    write('config/packages/zz_twig_list.yaml', ['twig:', '    paths:', "        - 'd/templates'", ''].join('\n'));
    expect(TwigConfig.load(tmp, 'dev').paths).toEqual([
      { dir: path.join(tmp, 'a', 'templates'), namespace: null },
      { dir: path.join(tmp, 'b', 'templates'), namespace: 'B' },
      { dir: path.join(tmp, 'c', 'templates'), namespace: null },
      { dir: path.join(tmp, 'd', 'templates'), namespace: null },
    ]);
  });

  it('merges when@<env> and config/packages/<env>/ after the main blocks', () => {
    write(
      'config/packages/twig.yaml',
      [
        'twig:',
        "    default_path: 'views'",
        '    paths:',
        "        'a': A",
        'when@dev:',
        '    twig:',
        '        paths:',
        "            'a': A2",
        "            'b': B",
        'when@prod:',
        '    twig:',
        "        default_path: 'prod-views'",
        '',
      ].join('\n'),
    );
    write('config/packages/dev/twig.yaml', ['twig:', "    default_path: '%kernel.project_dir%/dev-views'", ''].join('\n'));
    const config = TwigConfig.load(tmp, 'dev');
    expect(config.defaultPath).toBe(path.join(tmp, 'dev-views'));
    // A redefined key keeps its position, as Symfony merges prototyped arrays.
    expect(config.paths).toEqual([
      { dir: path.join(tmp, 'a'), namespace: 'A2' },
      { dir: path.join(tmp, 'b'), namespace: 'B' },
    ]);
  });

  it('skips paths using parameters it cannot resolve', () => {
    write(
      'config/packages/twig.yaml',
      ['twig:', "    default_path: '%env(VIEWS_DIR)%'", '    paths:', "        '%app.dir%/templates': App", ''].join('\n'),
    );
    const config = TwigConfig.load(tmp, 'dev');
    expect(config.defaultPath).toBeNull();
    expect(config.paths).toEqual([]);
    expect(config.warnings).toHaveLength(2);
  });
});
