import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { provideTranslationDiagnostics, TRANSLATION_NOT_FOUND } from '../../../src/features/translations/diagnostics';
import { TranslationReferenceFinder } from '../../../src/features/translations/TranslationReferenceFinder';
import { TranslationIndex } from '../../../src/index/TranslationIndex';
import type { DocumentLanguage, Parsers } from '../../../src/parsing/parsers';
import { pathToUri } from '../../../src/util/paths';
import { fixtureApp, loadParsers } from '../../helpers';

describe('translation diagnostics', () => {
  let parsers: Parsers;
  let finder: TranslationReferenceFinder;
  let dir: string;

  const write = (relative: string, content: string): string => {
    const file = path.join(dir, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };

  beforeAll(async () => {
    parsers = await loadParsers();
    finder = new TranslationReferenceFinder(parsers);
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symfony-zed-translation-diagnostics-'));
    write('composer.json', JSON.stringify({ autoload: { 'psr-4': { 'App\\': 'src/' } } }));
    write(
      'vendor/composer/installed.json',
      JSON.stringify({
        packages: [
          { name: 'acme/bundle', autoload: { 'psr-4': { 'Acme\\Bundle\\': 'src/' } }, 'install-path': '../acme/bundle' },
          { name: 'symfony/validator', 'install-path': '../symfony/validator' },
        ],
      }),
    );
    write(
      'vendor/acme/bundle/src/AcmeBundle.php',
      '<?php\nnamespace Acme\\Bundle;\nuse Symfony\\Component\\HttpKernel\\Bundle\\AbstractBundle;\nfinal class AcmeBundle extends AbstractBundle {}\n',
    );
    write('vendor/acme/bundle/translations/acme.fr.yaml', 'hello: Bonjour\n');
    write('vendor/symfony/validator/Resources/translations/validators.fr.xlf', '<xliff/>');
    write('config/bundles.php', "<?php\nreturn [\n    Acme\\Bundle\\AcmeBundle::class => ['all' => true],\n];\n");
    write('config/packages/translation.yaml', 'framework:\n  default_locale: fr\n');
    write('translations/messages.fr.yaml', 'home:\n  title: Accueil\n');
    write('translations/messages.en.yaml', 'only_en: English\n');
    write('translations/admin.en.yaml', 'dashboard: Dashboard\n');
    write('translations/legacy.fr.json', '{}');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function diagnose(language: DocumentLanguage, source: string, index = new TranslationIndex(dir, parsers)) {
    const document = TextDocument.create(pathToUri(path.join(dir, language === 'php' ? 'src/A.php' : 'templates/a.html.twig')), language, 1, source);
    const tree = parsers.parse(language, source)!;
    const references = finder.find(language, tree.rootNode);
    tree.delete();
    return provideTranslationDiagnostics(document, references, index).map((diagnostic) => ({
      text: source.slice(document.offsetAt(diagnostic.range.start), document.offsetAt(diagnostic.range.end)),
      code: diagnostic.code,
      message: diagnostic.message,
    }));
  }

  it('reports a key missing from the default locale', () => {
    expect(diagnose('twig', `{{ 'home.title'|trans }} {{ 'home.nope'|trans }} {{ 'only_en'|trans }}`)).toEqual([
      { text: "'home.nope'", code: TRANSLATION_NOT_FOUND, message: 'Translation "home.nope" not found in domain "messages" for locale "fr".' },
      { text: "'only_en'", code: TRANSLATION_NOT_FOUND, message: 'Translation "only_en" not found in domain "messages" for locale "fr".' },
    ]);
    expect(diagnose('twig', `{% trans %}\n  home.nope\n{% endtrans %}`).map((diagnostic) => diagnostic.text)).toEqual(['home.nope']);
    expect(diagnose('php', `<?php $t->trans('home.nope'); $t->trans('home.title', [], 'messages');`).map((d) => d.text)).toEqual(["'home.nope'"]);
  });

  it('finds keys in a parent of the default locale', () => {
    write('config/packages/translation.yaml', 'framework:\n  default_locale: fr_FR\n');
    expect(diagnose('twig', `{{ 'home.title'|trans }} {{ 'home.nope'|trans }}`).map((d) => d.text)).toEqual(["'home.nope'"]);
  });

  it.each<[string, DocumentLanguage, string]>([
    ['a domain without file in the default locale', 'twig', `{{ 'nope'|trans({}, 'admin') }}`],
    ['a domain provided by a bundle', 'twig', `{{ 'nope'|trans({}, 'acme') }}`],
    ['a domain provided by a component', 'php', `<?php $t->trans('nope', [], 'validators');`],
    ['a domain with a file in a format that is not read', 'twig', `{{ 'nope'|trans({}, 'legacy') }}`],
    ['an unknown domain', 'twig', `{{ 'nope'|trans({}, domain) }}`],
    ['a dynamic key', 'twig', `{{ ('home.' ~ x)|trans }}`],
    ['an empty key', 'twig', `{{ ''|trans }}`],
  ])('reports nothing for %s', (_label, language, source) => {
    expect(diagnose(language, source)).toEqual([]);
  });

  it.each<[string, () => void]>([
    ['a bundle cannot be located', () => write('config/bundles.php', "<?php\nreturn [\n    Acme\\Missing\\MissingBundle::class => ['all' => true],\n];\n")],
    ['vendor/composer/installed.json is missing', () => fs.rmSync(path.join(dir, 'vendor', 'composer', 'installed.json'))],
    ['the configuration is in PHP', () => write('config/packages/framework.php', '<?php')],
    ['a package YAML is invalid', () => write('config/packages/broken.yaml', 'a: [')],
    ['a file of the catalogue is invalid', () => write('translations/messages+intl-icu.fr.yaml', 'a: [')],
  ])('reports nothing when %s', (_label, change) => {
    change();
    expect(diagnose('twig', `{{ 'home.nope'|trans }}`)).toEqual([]);
  });

  it('follows open documents, and stays silent while one of them is invalid', () => {
    const index = new TranslationIndex(dir, parsers);
    const file = path.join(dir, 'translations', 'messages.fr.yaml');
    index.updateFile(file, 'home:\n  title: Accueil\n  nope: Ajouté\n');
    expect(diagnose('twig', `{{ 'home.nope'|trans }}`, index)).toEqual([]);
    index.updateFile(file, 'home: [');
    expect(diagnose('twig', `{{ 'home.missing'|trans }}`, index)).toEqual([]);
    index.updateFile(file, null);
    expect(diagnose('twig', `{{ 'home.nope'|trans }}`, index).map((d) => d.text)).toEqual(["'home.nope'"]);
  });

  it('is not certain on the fixture, whose framework bundle cannot be located', () => {
    expect(new TranslationIndex(fixtureApp, parsers).isCertain('messages')).toBe(false);
  });
});
