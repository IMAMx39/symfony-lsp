import * as path from 'node:path';
import type { TextEdit } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { beforeAll, describe, expect, it } from 'vitest';
import { provideTranslationCompletion } from '../../../src/features/translations/completion';
import { provideTranslationDefinition } from '../../../src/features/translations/definition';
import { TranslationReferenceFinder, type TranslationReference } from '../../../src/features/translations/TranslationReferenceFinder';
import { TranslationIndex } from '../../../src/index/TranslationIndex';
import type { DocumentLanguage, Parsers } from '../../../src/parsing/parsers';
import { pathToUri, uriToPath } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

let parsers: Parsers;
let finder: TranslationReferenceFinder;
let index: TranslationIndex;

beforeAll(async () => {
  parsers = await loadParsers();
  finder = new TranslationReferenceFinder(parsers);
  index = new TranslationIndex(fixtureApp, parsers);
});

/** Twig filters need `|`: the cursor marker is `¦`. */
function at(language: DocumentLanguage, source: string): { document: TextDocument; offset: number; references: TranslationReference[] } {
  const file = path.join(fixtureApp, language === 'php' ? 'src/Controller/TestController.php' : 'templates/test.html.twig');
  const { document, offset } = withCursor(pathToUri(file), language, source, '¦');
  const tree = parsers.parse(language, document.getText())!;
  const references = finder.find(language, tree.rootNode);
  tree.delete();
  return { document, offset, references };
}

function definition(language: DocumentLanguage, source: string): string[] | null {
  const { document, offset, references } = at(language, source);
  const locations = provideTranslationDefinition(document, document.positionAt(offset), references, index);
  return locations && locations.map((location) => `${path.relative(fixtureApp, uriToPath(location.uri)).split(path.sep).join('/')}:${location.range.start.line}`);
}

function domainAt(language: DocumentLanguage, source: string): string | null | undefined {
  const { offset, references } = at(language, source);
  return references.find((reference) => offset >= reference.start && offset < reference.end)?.domain;
}

describe('translation definition', () => {
  it.each<[string, DocumentLanguage, string]>([
    ['|trans', 'twig', `{{ 'home.ti¦tle'|trans }}`],
    ['|trans with parameters', 'twig', `{{ "home.title¦"|trans({'%name%': 'x'}) }}`],
    ['a chained |trans', 'twig', `{{ x|default('home.t¦itle'|trans)|upper }}`],
    ['{% trans %}', 'twig', `{% trans %}home.ti¦tle{% endtrans %}`],
    ['{% trans %} with whitespace control', 'twig', `{%- trans with {'%n%': 1} -%}\n  home.ti¦tle\n{%- endtrans %}`],
    ['->trans()', 'php', `<?php $translator->trans('home.ti¦tle');`],
    ['->trans() with named arguments', 'php', `<?php $this->translator->trans(id: 'home.title¦', parameters: []);`],
  ])('goes to every locale from %s', (_label, language, source) => {
    expect(definition(language, source)).toEqual(['translations/messages.fr.yaml:1', 'translations/messages+intl-icu.en.yaml:1']);
  });

  it.each<[string, DocumentLanguage, string]>([
    ['a positional domain', 'twig', `{{ 'admin.dash¦board'|trans({}, 'admin') }}`],
    ['a named domain', 'twig', `{{ 'admin.dash¦board'|trans(domain: 'admin') }}`],
    ['from', 'twig', `{% trans from 'admin' %}admin.dash¦board{% endtrans %}`],
    ['trans_default_domain', 'twig', `{% trans_default_domain 'admin' %}{% block b %}{{ 'admin.dash¦board'|trans }}{% endblock %}`],
    ['a PHP domain', 'php', `<?php $t->trans('admin.dash¦board', [], 'admin');`],
    ['a named PHP domain', 'php', `<?php $t->trans('admin.dash¦board', domain: 'admin');`],
  ])('uses %s', (_label, language, source) => {
    expect(definition(language, source)).toEqual(['translations/admin.fr.xlf:4']);
  });

  it('unescapes %% in a {% trans %} body', () => {
    const { references } = at('twig', `{% trans %} 100%% ¦sure {% endtrans %}`);
    expect(references.map((reference) => reference.key)).toEqual(['100% sure']);
  });

  it.each<[string, DocumentLanguage, string]>([
    ['an unknown key', 'twig', `{{ 'nope¦'|trans }}`],
    ['a key of another domain', 'twig', `{{ 'admin.dash¦board'|trans }}`],
    ['a dynamic key', 'twig', `{{ ('home.' ~ na¦me)|trans }}`],
    ['a variable domain', 'twig', `{{ 'home.ti¦tle'|trans({}, domain) }}`],
    ['a dynamic {% trans %} body', 'twig', `{% trans %}home.ti¦tle {{ x }}{% endtrans %}`],
    ['a variable PHP domain', 'php', `<?php $t->trans('home.ti¦tle', [], $domain);`],
    ['an interpolated PHP key', 'php', `<?php $t->trans("home.{$x}¦");`],
    ['argument unpacking', 'php', `<?php $t->trans('home.ti¦tle', ...$args);`],
    ['another method', 'php', `<?php $t->translate('home.ti¦tle');`],
    ['another filter', 'twig', `{{ 'home.ti¦tle'|upper }}`],
  ])('returns nothing for %s', (_label, language, source) => {
    expect(definition(language, source)).toBeNull();
  });
});

describe('trans_default_domain', () => {
  it.each<[string, string, string | null]>([
    ['no tag', `{{ 'k¦'|trans }}`, 'messages'],
    ['a top-level literal tag', `{% trans_default_domain 'admin' %}{{ 'k¦'|trans }}`, 'admin'],
    ['an explicit domain', `{% trans_default_domain 'admin' %}{{ 'k¦'|trans({}, 'other') }}`, 'other'],
    ['an explicit null domain', `{% trans_default_domain 'admin' %}{{ 'k¦'|trans({}, null) }}`, 'messages'],
    ['a node before the tag', `{{ 'k¦'|trans }}{% trans_default_domain 'admin' %}`, null],
    ['a variable tag', `{% trans_default_domain dom %}{{ 'k¦'|trans }}`, null],
    ['several tags', `{% trans_default_domain 'a' %}{% trans_default_domain 'b' %}{{ 'k¦'|trans }}`, null],
    ['a tag in a block', `{% block b %}{% trans_default_domain 'a' %}{{ 'k¦'|trans }}{% endblock %}`, null],
    ['an embed', `{% trans_default_domain 'a' %}{% embed 'x.twig' %}{% block b %}{{ 'k¦'|trans }}{% endblock %}{% endembed %}`, null],
  ])('%s', (_label, source, expected) => {
    expect(domainAt('twig', source)).toBe(expected);
  });
});

describe('translation completion', () => {
  function complete(language: DocumentLanguage, source: string) {
    const { document, offset, references } = at(language, source);
    const items = provideTranslationCompletion(document, document.positionAt(offset), references, index);
    const apply = (label: string): string => {
      const edit = items?.find((item) => item.label === label)?.textEdit as TextEdit;
      const text = document.getText();
      return text.slice(0, document.offsetAt(edit.range.start)) + edit.newText + text.slice(document.offsetAt(edit.range.end));
    };
    return { items, apply };
  }

  it('proposes the keys of the domain with their default-locale value', () => {
    const { items, apply } = complete('twig', `{{ 'home.¦'|trans }}`);
    const labels = items?.map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(['home.title', 'home.intro', 'blog.read_more', 'lib_only', 'only_en']));
    expect(labels).not.toContain('admin.dashboard');
    expect(items?.find((item) => item.label === 'home.title')?.detail).toBe('Accueil');
    expect(apply('home.title')).toBe(`{{ 'home.title'|trans }}`);
  });

  it('completes in PHP and in a {% trans %} body, empty or not', () => {
    expect(complete('php', `<?php $t->trans('adm¦in', [], 'admin');`).apply('admin.dashboard')).toBe(`<?php $t->trans('admin.dashboard', [], 'admin');`);
    expect(complete('twig', `{% trans %}  ho¦me {% endtrans %}`).apply('home.title')).toBe(`{% trans %}  home.title {% endtrans %}`);
    expect(complete('twig', `{% trans %}¦{% endtrans %}`).apply('shared')).toBe(`{% trans %}shared{% endtrans %}`);
  });

  it('leaves out keys that would need escaping', () => {
    const local = new TranslationIndex(fixtureApp, parsers);
    const keys = ["it's", 'a\\b', '$x', '100%%', 'plain'];
    // Single-quoted YAML scalars: only `'` needs escaping (as `''`).
    const yaml = keys.map((key) => `'${key.replace(/'/g, "''")}': x\n`).join('');
    local.updateFile(path.join(fixtureApp, 'translations', 'messages.fr.yaml'), yaml);
    const labels = (language: DocumentLanguage, source: string): string[] => {
      const { document, offset, references } = at(language, source);
      const items = provideTranslationCompletion(document, document.positionAt(offset), references, local) ?? [];
      return items.map((item) => item.label).filter((label) => keys.includes(label)).sort();
    };
    expect(labels('php', `<?php $t->trans('¦');`)).toEqual(['$x', '100%%', 'plain']);
    expect(labels('php', `<?php $t->trans("¦");`)).toEqual(['100%%', 'it\'s', 'plain']);
    expect(labels('twig', `{% trans %}¦{% endtrans %}`)).toEqual(['$x', 'a\\b', 'it\'s', 'plain']);
  });

  it.each<[string, DocumentLanguage, string]>([
    ['outside the quotes', 'twig', `{{ ¦'home'|trans }}`],
    ['an unknown domain', 'twig', `{{ 'home¦'|trans({}, domain) }}`],
    ['a non-translated literal', 'twig', `{{ 'home¦' }}`],
  ])('proposes nothing %s', (_label, language, source) => {
    expect(complete(language, source).items).toBeNull();
  });
});
