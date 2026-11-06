import { describe, expect, it } from 'vitest';
import { parseTranslationFile, parseTranslationFileName } from '../../src/translations/translationFiles';

describe('parseTranslationFileName', () => {
  it.each([
    ['messages.fr.yaml', { domain: 'messages', locale: 'fr', format: 'yaml' }],
    ['messages.fr_FR.yml', { domain: 'messages', locale: 'fr_FR', format: 'yaml' }],
    ['messages+intl-icu.en.xlf', { domain: 'messages', locale: 'en', format: 'xliff' }],
    ['app.admin.de.xliff', { domain: 'app.admin', locale: 'de', format: 'xliff' }],
    ['messages.fr.json', { domain: 'messages', locale: 'fr', format: null }],
  ])('splits %s', (name, expected) => {
    expect(parseTranslationFileName(name)).toEqual(expected);
  });

  it.each(['messages.yaml', 'README.md', 'messages.f r.yaml', 'messages.fr.'])('rejects %s', (name) => {
    expect(parseTranslationFileName(name)).toBeNull();
  });
});

describe('parseTranslationFile (YAML)', () => {
  it('flattens nested keys with dots and skips null values', () => {
    const source = 'home:\n  title: Accueil\n  nested:\n    deep: 1\nflat.key: x\nnone: ~\n';
    const messages = parseTranslationFile(source, 'yaml');
    expect(messages?.map(({ key, value }) => [key, value])).toEqual([
      ['home.title', 'Accueil'],
      ['home.nested.deep', '1'],
      ['flat.key', 'x'],
    ]);
    const deep = messages?.find((message) => message.key === 'home.nested.deep');
    expect(deep && source.slice(deep.start, deep.end)).toBe('deep');
  });

  it('reads an empty file as no message, and invalid YAML or a scalar as invalid', () => {
    expect(parseTranslationFile('', 'yaml')).toEqual([]);
    expect(parseTranslationFile('# only a comment\n', 'yaml')).toEqual([]);
    expect(parseTranslationFile('a: [', 'yaml')).toBeNull();
    expect(parseTranslationFile('just a string', 'yaml')).toBeNull();
  });
});

describe('parseTranslationFile (XLIFF)', () => {
  const xliff1 = (units: string): string =>
    `<?xml version="1.0"?>\n<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2"><file><body>${units}</body></file></xliff>`;

  it('reads XLIFF 1.2 keys from resname, else from the source', () => {
    const source = xliff1(
      '<trans-unit id="1" resname="a.b"><source>ignored</source><target>AB</target></trans-unit>' +
        '<trans-unit id="2"><source>Save &amp; quit</source><target>Enregistrer</target></trans-unit>' +
        '<trans-unit id="3" resname=""><source><![CDATA[<b>Bold</b>]]></source></trans-unit>',
    );
    const messages = parseTranslationFile(source, 'xliff');
    expect(messages?.map(({ key, value }) => [key, value])).toEqual([
      ['a.b', 'AB'],
      ['Save & quit', 'Enregistrer'],
      ['<b>Bold</b>', '<b>Bold</b>'],
    ]);
    expect(messages?.map((message) => source.slice(message.start, message.end))).toEqual([
      'a.b',
      'Save &amp; quit',
      '<![CDATA[<b>Bold</b>]]>',
    ]);
  });

  it('skips commented units and keys holding markup', () => {
    const source = xliff1(
      '<!-- <trans-unit id="1" resname="old"><source>old</source></trans-unit> -->' +
        '<trans-unit id="2"><source>Hello <g id="1">world</g></source></trans-unit>',
    );
    expect(parseTranslationFile(source, 'xliff')).toEqual([]);
  });

  it('reads XLIFF 2.0 keys from the unit name, else from the segment source', () => {
    const source =
      '<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en"><file id="f">' +
      '<unit id="u1" name="email.invalid"><segment><source>email.invalid</source><target>Invalid.</target></segment></unit>' +
      '<unit id="u2"><segment><source>Too short</source></segment></unit>' +
      '</file></xliff>';
    expect(parseTranslationFile(source, 'xliff')?.map(({ key, value }) => [key, value])).toEqual([
      ['email.invalid', 'Invalid.'],
      ['Too short', 'Too short'],
    ]);
  });

  it('rejects malformed XML', () => {
    expect(parseTranslationFile(xliff1('<trans-unit id="1"><source>x</trans-unit>'), 'xliff')).toBeNull();
  });
});
