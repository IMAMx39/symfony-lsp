import * as fs from 'node:fs';
import * as path from 'node:path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { beforeAll, describe, expect, it } from 'vitest';
import { provideTemplateDefinition } from '../../../src/features/templates/definition';
import { TemplateReferenceFinder } from '../../../src/features/templates/TemplateReferenceFinder';
import type { Parsers } from '../../../src/parsing/parsers';
import type { TemplateResolver } from '../../../src/project/TemplateResolver';
import { isSamePath, pathToUri, uriToPath } from '../../../src/util/paths';
import { fixtureApp, fixtureResolver, loadParsers, withCursor } from '../../helpers';

const twigUri = pathToUri(path.join(fixtureApp, 'templates', 'test.html.twig'));
const template = (name: string): string => path.join(fixtureApp, 'templates', ...name.split('/'));

describe('Twig template definition', () => {
  let parsers: Parsers;
  let finder: TemplateReferenceFinder;
  let resolver: TemplateResolver;

  beforeAll(async () => {
    parsers = await loadParsers();
    finder = new TemplateReferenceFinder(parsers);
    resolver = await fixtureResolver();
  });

  function definitionIn(document: TextDocument, offset: number): string | null {
    const tree = parsers.parse('twig', document.getText())!;
    const references = finder.findInTwig(tree.rootNode);
    const location = provideTemplateDefinition(document, document.positionAt(offset), references, resolver);
    tree.delete();
    return location === null ? null : uriToPath(location.uri);
  }

  function definitionAt(source: string): string | null {
    const marker = source.includes('‸') ? '‸' : '|';
    const { document, offset } = withCursor(twigUri, 'twig', source, marker);
    return definitionIn(document, offset);
  }

  function expectTemplate(actual: string | null, name: string): void {
    expect(actual).not.toBeNull();
    expect(isSamePath(actual!, template(name))).toBe(true);
  }

  it.each([
    ['extends', `{% extends 'base|.html.twig' %}`],
    ['extends (double quotes)', `{% extends "base|.html.twig" %}`],
    ['include', `{% include 'base.html.twig|' with {a: 1} only %}`],
    ['include ignore missing', `{% include 'ba|se.html.twig' ignore missing %}`],
    ['embed', `{% embed 'base|.html.twig' %}{% block body %}{% endblock %}{% endembed %}`],
    ['import', `{% import 'base|.html.twig' as m %}`],
    ['from', `{% from 'base|.html.twig' import a as b, c %}`],
    ['use', `{% use 'base|.html.twig' %}`],
    ['include()', `{{ include('base|.html.twig', {a: 1}) }}`],
    ['include() with a filter', `{{ include('base‸.html.twig')|raw }}`],
    ['source()', `{% set s = source('base|.html.twig') %}`],
    ['array item', `{% include ['missing.html.twig', 'base|.html.twig'] %}`],
    ['ternary branch', `{% extends ajax ? 'base|.html.twig' : 'home/index.html.twig' %}`],
    ['tag nested in HTML and control flow', `<div>{% if x %}{% include 'base|.html.twig' %}{% endif %}</div>`],
  ])('resolves %s', (_label, source) => {
    expectTemplate(definitionAt(source), 'base.html.twig');
  });

  it('resolves each tag of the fixture dashboard', () => {
    const file = template('admin/dashboard.html.twig');
    const text = fs.readFileSync(file, 'utf8');
    const document = TextDocument.create(pathToUri(file), 'twig', 1, text);
    const offsets = (needle: string): number[] =>
      [...text.matchAll(new RegExp(needle, 'g'))].map((match) => match.index + 2);

    expectTemplate(definitionIn(document, offsets("'base")[0]!), 'base.html.twig');
    expectTemplate(definitionIn(document, offsets("'macros")[0]!), 'macros.html.twig');
    const heroes = offsets("'home/_hero");
    expect(heroes).toHaveLength(2);
    for (const offset of heroes) {
      expectTemplate(definitionIn(document, offset), 'home/_hero.html.twig');
    }
  });

  it('handles CRLF line endings and non-ASCII content', () => {
    expectTemplate(definitionAt(`{# déjà 😀 #}\r\n<p>é</p>\r\n{% include 'base|.html.twig' %}\r\n`), 'base.html.twig');
  });

  it('still resolves earlier tags while the template is being edited', () => {
    expectTemplate(definitionAt(`{% extends 'base|.html.twig' %}\n{% include 'unterminated`), 'base.html.twig');
  });

  it.each([
    ['concatenation', `{% include 'ba|se' ~ suffix %}`],
    ['variable', `{% include templ|ate %}`],
    ['interpolated string', `{% include "home/#{na|me}.html.twig" %}`],
    ['escaped quote', `{% include 'it\\'s|.html.twig' %}`],
    ['named argument', `{{ include(template_name='base|.html.twig') }}`],
    ['second argument', `{{ include('base.html.twig', 'base|.html.twig') }}`],
    ['method named include', `{{ foo.include('base|.html.twig') }}`],
    ['unrelated function', `{{ trans('base|.html.twig') }}`],
    ['plain output', `{{ 'base|.html.twig' }}`],
    ['text content', `<p>base|.html.twig</p>`],
    ['comment', `{# {% include 'base|.html.twig' %} #}`],
    ['missing template', `{% include 'miss|ing.html.twig' %}`],
    ['_self', `{% import _se|lf as m %}`],
  ])('returns nothing for %s', (_label, source) => {
    expect(definitionAt(source)).toBeNull();
  });
});
