import * as path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TranslationIndex } from '../../src/index/TranslationIndex';
import type { Parsers } from '../../src/parsing/parsers';
import { uriToPath } from '../../src/util/paths';
import { fixtureApp, loadParsers } from '../helpers';

const relative = (uri: string): string => path.relative(fixtureApp, uriToPath(uri)).split(path.sep).join('/');

describe('TranslationIndex', () => {
  let parsers: Parsers;
  let index: TranslationIndex;

  beforeAll(async () => {
    parsers = await loadParsers();
  });

  beforeEach(() => {
    index = new TranslationIndex(fixtureApp, parsers);
  });

  it('lists the definitions of a key, default locale first', () => {
    const entries = index.entries('messages', 'home.title');
    expect(entries.map((entry) => [entry.locale, entry.value, relative(entry.location.uri)])).toEqual([
      ['fr', 'Accueil', 'translations/messages.fr.yaml'],
      ['en', 'Home', 'translations/messages+intl-icu.en.yaml'],
    ]);
    expect(entries[0]?.location.range.start).toEqual({ line: 1, character: 4 });
  });

  it('puts the overriding directory first (default_path over translator.paths)', () => {
    expect(index.entries('messages', 'shared').map((entry) => [entry.value, relative(entry.location.uri)])).toEqual([
      ['Projet', 'translations/messages.fr.yaml'],
      ['Projet (lib)', 'lib/translations/messages.fr.yaml'],
    ]);
  });

  it('reads XLIFF files, in subdirectories too', () => {
    expect(index.entries('admin', 'admin.dashboard').map((entry) => entry.value)).toEqual(['Tableau de bord']);
    expect(index.entries('admin', 'Save & quit')).toHaveLength(1);
    expect(index.entries('admin', 'admin.commented')).toEqual([]);
    expect(index.entries('validators', 'email.invalid').map((entry) => entry.value)).toEqual(['This email is invalid.']);
  });

  it('lists the keys of a domain with the winning value of the default locale', () => {
    const keys = new Map(index.keys('messages').map(({ key, value }) => [key, value]));
    expect(keys.get('home.title')).toBe('Accueil');
    expect(keys.get('shared')).toBe('Projet');
    expect(keys.get('lib_only')).toBe('Depuis lib');
    expect(keys.get('only_en')).toBeNull();
    expect(keys.has('untranslated')).toBe(false);
    expect(index.keys('nope')).toEqual([]);
  });

  it('lets an open document override its file, keeping the previous messages while invalid', () => {
    const file = path.join(fixtureApp, 'translations', 'messages.fr.yaml');
    expect(index.updateFile(file, 'home:\n  title: Maison\n')).toBe(true);
    expect(index.entries('messages', 'home.title')[0]?.value).toBe('Maison');
    expect(index.entries('messages', 'blog.read_more')).toEqual([]);
    expect(index.updateFile(file, 'home: [')).toBe(true);
    expect(index.entries('messages', 'home.title')[0]?.value).toBe('Maison');
    index.updateFile(file, null);
    expect(index.entries('messages', 'home.title')[0]?.value).toBe('Accueil');
  });

  it('ignores files outside the translation directories or in another format', () => {
    expect(index.updateFile(path.join(fixtureApp, 'config', 'messages.fr.yaml'), 'a: b')).toBe(false);
    expect(index.updateFile(path.join(fixtureApp, 'translations', 'messages.fr.json'), '{}')).toBe(false);
    expect(index.isTranslationFile(path.join(fixtureApp, 'translations', 'admin.fr.xlf'))).toBe(true);
  });
});
