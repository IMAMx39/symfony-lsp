import * as path from 'node:path';
import type { Diagnostic } from 'vscode-languageserver';
import { beforeAll, describe, expect, it } from 'vitest';
import { provideTemplateDiagnostics, TEMPLATE_NOT_FOUND } from '../../../src/features/templates/diagnostics';
import { TemplateReferenceFinder } from '../../../src/features/templates/TemplateReferenceFinder';
import type { DocumentLanguage, Parsers } from '../../../src/parsing/parsers';
import { TemplateResolver } from '../../../src/project/TemplateResolver';
import { TwigLoaderPaths } from '../../../src/project/TwigLoaderPaths';
import { pathToUri } from '../../../src/util/paths';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { fixtureApp, loadParsers } from '../../helpers';

describe('template diagnostics', () => {
  let parsers: Parsers;
  let finder: TemplateReferenceFinder;
  let loaderPaths: TwigLoaderPaths;
  let resolver: TemplateResolver;

  beforeAll(async () => {
    parsers = await loadParsers();
    finder = new TemplateReferenceFinder(parsers);
    loaderPaths = TwigLoaderPaths.build(fixtureApp, parsers);
    resolver = new TemplateResolver(loaderPaths.namespaces);
  });

  function diagnose(language: DocumentLanguage, text: string, isCertain = (ns: string) => loaderPaths.isCertain(ns)): Diagnostic[] {
    const file = path.join(fixtureApp, language === 'php' ? 'src/Controller/TestController.php' : 'templates/test.html.twig');
    const document = TextDocument.create(pathToUri(file), language, 1, text);
    const tree = parsers.parse(language, text)!;
    const references = finder.find(language, tree.rootNode);
    tree.delete();
    return provideTemplateDiagnostics(document, references, resolver, isCertain);
  }

  /** Text covered by each diagnostic. */
  function flagged(language: DocumentLanguage, text: string): string[] {
    const document = TextDocument.create('file:///x', language, 1, text);
    return diagnose(language, text).map((diagnostic) =>
      text.slice(document.offsetAt(diagnostic.range.start), document.offsetAt(diagnostic.range.end)),
    );
  }

  it('flags a missing template in PHP, with a precise range', () => {
    const text = `<?php\r\n// é\r\n$this->render('home/missing.html.twig');`;
    const [diagnostic, ...others] = diagnose('php', text);
    expect(others).toEqual([]);
    expect(diagnostic?.code).toBe(TEMPLATE_NOT_FOUND);
    expect(diagnostic?.message).toBe('Template "home/missing.html.twig" not found.');
    expect(diagnostic?.range).toEqual({ start: { line: 2, character: 14 }, end: { line: 2, character: 38 } });
  });

  it.each<[string, DocumentLanguage, string, string[]]>([
    ['render()', 'php', `<?php $this->render('nope.html.twig');`, [`'nope.html.twig'`]],
    ['#[Template]', 'php', `<?php class A { #[Template('nope.html.twig')] public function a() {} }`, [`'nope.html.twig'`]],
    ['extends', 'twig', `{% extends 'nope.html.twig' %}`, [`'nope.html.twig'`]],
    ['include()', 'twig', `{{ include("nope.html.twig") }}`, [`"nope.html.twig"`]],
    ['a known namespace', 'twig', `{% include '@AcmeFoo/nope.html.twig' %}`, [`'@AcmeFoo/nope.html.twig'`]],
    ['@! without the override', 'twig', `{% include '@!AcmeFoo/nope.html.twig' %}`, [`'@!AcmeFoo/nope.html.twig'`]],
    ['wrong case', 'twig', `{% include 'Base.html.twig' %}`, [`'Base.html.twig'`]],
    ['each missing ternary branch', 'twig', `{% extends x ? 'base.html.twig' : 'nope.html.twig' %}`, [`'nope.html.twig'`]],
    ['an array where nothing exists', 'twig', `{% include ['a.html.twig', 'b.html.twig'] %}`, [`'a.html.twig'`, `'b.html.twig'`]],
  ])('flags %s', (_label, language, text, expected) => {
    expect(flagged(language, text)).toEqual(expected);
  });

  it.each<[string, DocumentLanguage, string]>([
    ['existing templates', 'twig', `{% extends 'base.html.twig' %}{% include '@AcmeFoo/layout.html.twig' %}{{ include('@Lib/card.html.twig') }}`],
    ['an existing PHP template', 'php', `<?php $this->render('home/index.html.twig');`],
    ['ignore missing', 'twig', `{% include 'nope.html.twig' ignore missing %}`],
    ['embed ignore missing', 'twig', `{% embed 'nope.html.twig' ignore missing %}{% endembed %}`],
    ['include() with ignore_missing', 'twig', `{{ include('nope.html.twig', {}, true, true) }}`],
    ['include() with a named ignore_missing', 'twig', `{{ include('nope.html.twig', ignore_missing = true) }}`],
    ['source() with ignore_missing', 'twig', `{{ source('nope.html.twig', true) }}`],
    ['an array with one existing item', 'twig', `{% include ['nope.html.twig', 'base.html.twig'] %}`],
    ['an array with a dynamic item', 'twig', `{% include ['nope.html.twig', name] %}`],
    ['a non-.twig name', 'twig', `{{ source('images/logo.svg') }}`],
    ['an unknown namespace', 'twig', `{% include '@Unknown/x.html.twig' %}`],
    ['a dynamic name', 'twig', `{% include 'nope' ~ '.html.twig' %}`],
    ['an empty literal being typed', 'twig', `{% include '' %}`],
    ['a template name in a comment', 'twig', `{# {% include 'nope.html.twig' %} #}`],
  ])('does not flag %s', (_label, language, text) => {
    expect(flagged(language, text)).toEqual([]);
  });

  it('stays silent when the namespace is not certain', () => {
    expect(diagnose('twig', `{% include 'nope.html.twig' %}`, () => false)).toEqual([]);
  });
});
