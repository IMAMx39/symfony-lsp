import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Parsers } from '../../src/parsing/parsers';
import { bundleRootDir, enabledBundles } from '../../src/project/bundles';
import { loadParsers } from '../helpers';

describe('bundles', () => {
  let parsers: Parsers;

  beforeAll(async () => {
    parsers = await loadParsers();
  });

  describe('enabledBundles', () => {
    const source = `<?php

return [
    Symfony\\Bundle\\FrameworkBundle\\FrameworkBundle::class => ['all' => true],
    \\Acme\\DevBundle::class => ['dev' => true, 'test' => true],
    Acme\\TestBundle::class => ['test' => true],
    Acme\\NotInDevBundle::class => ['all' => true, 'dev' => false],
    Acme\\DynamicBundle::class => ['dev' => $enabled],
    Acme\\DoubleQuotedBundle::class => ["dev" => TRUE],
];
`;

    it('keeps the bundles enabled in the environment, in order', () => {
      expect(enabledBundles(source, 'dev', parsers)).toEqual([
        'Symfony\\Bundle\\FrameworkBundle\\FrameworkBundle',
        'Acme\\DevBundle',
        'Acme\\DoubleQuotedBundle',
      ]);
    });

    it('evaluates another environment', () => {
      expect(enabledBundles(source, 'prod', parsers)).toEqual([
        'Symfony\\Bundle\\FrameworkBundle\\FrameworkBundle',
        'Acme\\NotInDevBundle',
      ]);
    });

    it('returns nothing for a file that does not return an array', () => {
      expect(enabledBundles('<?php return $bundles;', 'dev', parsers)).toEqual([]);
    });
  });

  describe('bundleRootDir', () => {
    const classFile = path.join(path.sep, 'vendor', 'acme', 'foo', 'src', 'AcmeFooBundle.php');
    const classDir = path.dirname(classFile);
    const root = (source: string): string | null => bundleRootDir(`<?php\n${source}`, classFile, 'AcmeFooBundle', parsers);

    it.each([
      ['Bundle (imported)', 'use Symfony\\Component\\HttpKernel\\Bundle\\Bundle;\nclass AcmeFooBundle extends Bundle {}', classDir],
      ['Bundle (aliased)', 'use Symfony\\Component\\HttpKernel\\Bundle\\Bundle as Base;\nfinal class AcmeFooBundle extends Base {}', classDir],
      ['Bundle (fully qualified)', 'class AcmeFooBundle extends \\Symfony\\Component\\HttpKernel\\Bundle\\Bundle {}', classDir],
      ['AbstractBundle', 'use Symfony\\Component\\HttpKernel\\Bundle\\AbstractBundle;\nclass AcmeFooBundle extends AbstractBundle {}', path.dirname(classDir)],
      ['getPath(): __DIR__', 'class AcmeFooBundle extends AbstractBundle { public function getPath(): string { return __DIR__; } }', classDir],
      ['getPath(): \\dirname(__DIR__)', 'class AcmeFooBundle extends Bundle { public function getPath(): string { return \\dirname(__DIR__); } }', path.dirname(classDir)],
      ['getPath(): dirname(__DIR__, 2)', 'class AcmeFooBundle extends Bundle {\n  // comment\n  public function getPath(): string { return dirname(__DIR__, 2); }\n}', path.dirname(path.dirname(classDir))],
    ])('locates %s', (_label, source, expected) => {
      expect(root(source)).toBe(expected);
    });

    it.each([
      ['an unknown base class', 'namespace Acme;\nclass AcmeFooBundle extends BaseBundle {}'],
      ['a Bundle class from another namespace', 'namespace Acme;\nclass AcmeFooBundle extends Bundle {}'],
      ['a computed getPath()', 'class AcmeFooBundle extends Bundle { public function getPath(): string { return $this->dir; } }'],
      ['a multi-statement getPath()', 'class AcmeFooBundle extends Bundle { public function getPath(): string { $d = __DIR__; return $d; } }'],
      ['dirname() of something else', 'class AcmeFooBundle extends Bundle { public function getPath(): string { return dirname(__FILE__); } }'],
      ['a missing class', 'class OtherBundle extends \\Symfony\\Component\\HttpKernel\\Bundle\\Bundle {}'],
    ])('returns null for %s', (_label, source) => {
      expect(root(source)).toBeNull();
    });
  });
});
