import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Parsers } from '../../src/parsing/parsers';
import { MAIN_NAMESPACE, TwigLoaderPaths } from '../../src/project/TwigLoaderPaths';
import { fixtureApp, loadParsers } from '../helpers';

const fixture = (...segments: string[]): string => path.join(fixtureApp, ...segments);

describe('TwigLoaderPaths', () => {
  let parsers: Parsers;

  beforeAll(async () => {
    parsers = await loadParsers();
  });

  it('mirrors TwigBundle registration order on the fixture', () => {
    const { namespaces, warnings } = TwigLoaderPaths.build(fixtureApp, parsers);
    expect(Object.fromEntries(namespaces)).toEqual({
      [MAIN_NAMESPACE]: [
        fixture('shared', 'templates'),
        fixture('templates'),
        fixture('vendor', 'symfony', 'twig-bridge', 'Resources', 'views', 'Form'),
      ],
      Lib: [fixture('lib', 'templates')],
      Dev: [fixture('dev', 'templates')],
      AcmeFoo: [fixture('templates', 'bundles', 'AcmeFooBundle'), fixture('vendor', 'acme', 'foo-bundle', 'templates')],
      '!AcmeFoo': [fixture('vendor', 'acme', 'foo-bundle', 'templates')],
      AcmeLegacy: [fixture('vendor', 'acme', 'legacy-bundle', 'Resources', 'views')],
      '!AcmeLegacy': [fixture('vendor', 'acme', 'legacy-bundle', 'Resources', 'views')],
    });
    // FrameworkBundle and TwigBundle are not installed in the fixture vendor/.
    expect(warnings).toEqual([
      'Cannot locate the templates of Symfony\\Bundle\\FrameworkBundle\\FrameworkBundle',
      'Cannot locate the templates of Symfony\\Bundle\\TwigBundle\\TwigBundle',
    ]);
  });

  describe('on a minimal project', () => {
    let tmp: string;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'symfony-zed-'));
    });

    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    function write(relative: string, content = ''): void {
      const file = path.join(tmp, ...relative.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }

    it('uses templates/ by default, without config, bundles nor vendor/', () => {
      write('composer.json', '{}');
      write('templates/base.html.twig');
      expect(Object.fromEntries(TwigLoaderPaths.build(tmp, parsers).namespaces)).toEqual({
        [MAIN_NAMESPACE]: [path.join(tmp, 'templates')],
      });
    });

    it('honours a custom default_path, for the main namespace and bundle overrides', () => {
      write('config/packages/twig.yaml', "twig:\n    default_path: '%kernel.project_dir%/views'\n");
      write('views/bundles/AcmeFooBundle/x.html.twig');
      write('config/bundles.php', "<?php return [Acme\\FooBundle\\AcmeFooBundle::class => ['all' => true]];");
      write('composer.json', JSON.stringify({ autoload: { 'psr-4': { 'Acme\\FooBundle\\': 'lib/' } } }));
      write('lib/AcmeFooBundle.php', '<?php namespace Acme\\FooBundle; class AcmeFooBundle extends \\Symfony\\Component\\HttpKernel\\Bundle\\Bundle {}');
      expect(Object.fromEntries(TwigLoaderPaths.build(tmp, parsers).namespaces)).toEqual({
        AcmeFoo: [path.join(tmp, 'views', 'bundles', 'AcmeFooBundle')],
        '!AcmeFoo': [path.join(tmp, 'views', 'bundles', 'AcmeFooBundle')],
        [MAIN_NAMESPACE]: [path.join(tmp, 'views')],
      });
    });

    it('leaves the namespace of an unlocatable bundle unknown, even with an override', () => {
      write('templates/bundles/GhostBundle/x.html.twig');
      write('config/bundles.php', "<?php return [Ghost\\GhostBundle::class => ['all' => true]];");
      const { namespaces, warnings } = TwigLoaderPaths.build(tmp, parsers);
      expect([...namespaces.keys()]).toEqual([MAIN_NAMESPACE]);
      expect(warnings).toEqual(['Cannot locate the templates of Ghost\\GhostBundle']);
    });

    it('reports an unparsable YAML file and keeps the defaults', () => {
      write('templates/base.html.twig');
      write('config/packages/twig.yaml', 'twig: [unclosed');
      const { namespaces, warnings } = TwigLoaderPaths.build(tmp, parsers);
      expect(namespaces.get(MAIN_NAMESPACE)).toEqual([path.join(tmp, 'templates')]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^Cannot parse .*twig\.yaml/);
    });
  });
});
