import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TranslatorConfig } from '../../src/project/TranslatorConfig';
import { fixtureApp } from '../helpers';

describe('TranslatorConfig', () => {
  it('reads the default locale and the directories of the fixture, lowest priority first', () => {
    const config = TranslatorConfig.load(fixtureApp, 'dev');
    expect(config.defaultLocale).toBe('fr');
    expect(config.dirs).toEqual([path.join(fixtureApp, 'lib', 'translations'), path.join(fixtureApp, 'translations')]);
    expect(config.warnings).toEqual([]);
  });

  describe('in a temporary project', () => {
    let dir: string;
    const write = (relative: string, content: string): void => {
      const file = path.join(dir, ...relative.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    };

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symfony-zed-translator-config-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('uses FrameworkBundle defaults without configuration', () => {
      const config = TranslatorConfig.load(dir, 'dev');
      expect(config.defaultLocale).toBe('en');
      expect(config.dirs).toEqual([path.join(dir, 'translations')]);
    });

    it('applies config/packages/dev and when@dev after the main files', () => {
      write('config/packages/translation.yaml', 'framework:\n  default_locale: de\n  translator:\n    paths: [a]\nwhen@dev:\n  framework:\n    translator:\n      paths: [b]\n');
      write('config/packages/dev/translation.yaml', 'framework:\n  default_locale: it\n  translator:\n    default_path: lang\n');
      const config = TranslatorConfig.load(dir, 'dev');
      expect(config.defaultLocale).toBe('it');
      expect(config.dirs).toEqual([path.join(dir, 'a'), path.join(dir, 'b'), path.join(dir, 'lang')]);
    });

    it('has no directory when the translator is disabled', () => {
      write('config/packages/framework.yaml', 'framework:\n  translator: false\n');
      expect(TranslatorConfig.load(dir, 'dev').dirs).toEqual([]);
      write('config/packages/framework.yaml', 'framework:\n  translator: { enabled: false }\n');
      expect(TranslatorConfig.load(dir, 'dev').dirs).toEqual([]);
    });

    it('warns about unresolved parameters, PHP configuration and invalid YAML', () => {
      write('config/packages/translation.yaml', "framework:\n  translator:\n    paths: ['%app.dir%/t']\n");
      write('config/packages/framework.php', '<?php');
      write('config/packages/broken.yaml', 'a: [');
      const config = TranslatorConfig.load(dir, 'dev');
      expect(config.dirs).toEqual([path.join(dir, 'translations')]);
      expect(config.warnings).toHaveLength(3);
    });
  });
});
