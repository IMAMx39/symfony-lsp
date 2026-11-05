import * as path from 'node:path';
import type { CompletionItem, TextEdit } from 'vscode-languageserver';
import { beforeAll, describe, expect, it } from 'vitest';
import { provideTemplateCompletion } from '../../../src/features/templates/completion';
import { TemplateReferenceFinder } from '../../../src/features/templates/TemplateReferenceFinder';
import { TemplateIndex, type IndexedTemplate } from '../../../src/index/TemplateIndex';
import type { DocumentLanguage, Parsers } from '../../../src/parsing/parsers';
import { TwigLoaderPaths } from '../../../src/project/TwigLoaderPaths';
import { pathToUri } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

describe('template completion', () => {
  let parsers: Parsers;
  let finder: TemplateReferenceFinder;
  let templates: IndexedTemplate[];

  beforeAll(async () => {
    parsers = await loadParsers();
    finder = new TemplateReferenceFinder(parsers);
    templates = new TemplateIndex(TwigLoaderPaths.build(fixtureApp, parsers).namespaces).templates();
  });

  function complete(language: DocumentLanguage, source: string): { items: CompletionItem[] | null; apply: (label: string) => string } {
    const file = path.join(fixtureApp, language === 'php' ? 'src/Controller/TestController.php' : 'templates/test.html.twig');
    const { document, offset } = withCursor(pathToUri(file), language, source);
    const tree = parsers.parse(language, document.getText())!;
    const references = finder.find(language, tree.rootNode);
    tree.delete();
    const items = provideTemplateCompletion(document, document.positionAt(offset), references, templates, fixtureApp);
    const apply = (label: string): string => {
      const edit = items?.find((item) => item.label === label)?.textEdit as TextEdit | undefined;
      if (!edit) {
        throw new Error(`No item ${label}`);
      }
      const text = document.getText();
      return text.slice(0, document.offsetAt(edit.range.start)) + edit.newText + text.slice(document.offsetAt(edit.range.end));
    };
    return { items, apply };
  }

  const labels = (items: CompletionItem[] | null): string[] => (items ?? []).map((item) => String(item.label));

  it.each<[string, DocumentLanguage, string]>([
    ['render()', 'php', `<?php $this->render('|');`],
    ['#[Template]', 'php', `<?php class A { #[Template('|')] public function a() {} }`],
    ['extends', 'twig', `{% extends '|' %}`],
    ['include (double quotes)', 'twig', `{% include "|" %}`],
    ['include()', 'twig', `{{ include('|') }}`],
    ['array item', 'twig', `{% include ['base.html.twig', '|'] %}`],
  ])('offers template names in %s', (_label, language, source) => {
    const { items } = complete(language, source);
    expect(labels(items)).toContain('base.html.twig');
    expect(labels(items)).toContain('@AcmeFoo/layout.html.twig');
    expect(labels(items)).not.toContain('@!AcmeFoo/layout.html.twig');
  });

  it('replaces the whole literal content, wherever the cursor is', () => {
    const { apply } = complete('twig', `{% extends 'ho|me/index' %}`);
    expect(apply('home/index.html.twig')).toBe(`{% extends 'home/index.html.twig' %}`);
  });

  it('keeps the closing quote and CRLF line endings intact', () => {
    const { apply } = complete('php', `<?php\r\n// é\r\n$this->render('|');\r\n`);
    expect(apply('base.html.twig')).toBe(`<?php\r\n// é\r\n$this->render('base.html.twig');\r\n`);
  });

  it('offers @! names only once @! is typed', () => {
    const items = complete('twig', `{% extends '@!|' %}`).items;
    expect(labels(items)).toEqual(['@!AcmeFoo/layout.html.twig', '@!AcmeFoo/widget.html.twig', '@!AcmeLegacy/index.html.twig']);
  });

  it('sorts main-namespace templates first and shows the file', () => {
    const items = complete('twig', `{% include '|' %}`).items ?? [];
    const sorted = [...items].sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? ''));
    expect(String(sorted[0]?.label)).not.toMatch(/^@/);
    expect(items.find((item) => item.label === 'priority.html.twig')?.detail).toBe('shared/templates/priority.html.twig');
  });

  it.each<[string, DocumentLanguage, string]>([
    ['outside the quotes', 'twig', `{% include ''| %}`],
    ['before the opening quote', 'twig', `{% include |'' %}`],
    ['a non-template string', 'twig', `{{ trans('|') }}`],
    ['a concatenation', 'twig', `{% include 'a|' ~ b %}`],
    ['a PHP method that does not render', 'php', `<?php $this->redirect('|');`],
  ])('offers nothing %s', (_label, language, source) => {
    expect(complete(language, source).items).toBeNull();
  });
});
