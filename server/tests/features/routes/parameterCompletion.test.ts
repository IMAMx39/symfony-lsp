import type { TextEdit } from 'vscode-languageserver';
import { beforeAll, describe, expect, it } from 'vitest';
import { provideRouteParameterCompletion } from '../../../src/features/routes/parameterCompletion';
import type { DocumentLanguage } from '../../../src/parsing/parsers';
import { routeTestContext, type RouteTestContext } from './routes.helpers';

describe('route parameter completion', () => {
  let ctx: RouteTestContext;

  beforeAll(async () => {
    ctx = await routeTestContext();
  });

  function complete(language: DocumentLanguage, source: string) {
    const { document, offset, references } = ctx.at(language, source, '‸');
    const items = provideRouteParameterCompletion(document, document.positionAt(offset), references, ctx.index);
    const labels = items?.map((item) => item.label) ?? null;
    const apply = (label: string): string => {
      const edit = items?.find((item) => item.label === label)?.textEdit as TextEdit;
      const text = document.getText();
      return text.slice(0, document.offsetAt(edit.range.start)) + edit.newText + text.slice(document.offsetAt(edit.range.end));
    };
    return { labels, apply };
  }

  describe('in Twig', () => {
    it('offers path variables in an empty object and inserts a key', () => {
      const { labels, apply } = complete('twig', `{{ path('blog_archive', {‸}) }}`);
      expect(labels).toEqual(['year', 'month']);
      expect(apply('year')).toBe(`{{ path('blog_archive', {year: }) }}`);
    });

    it('completes a key being typed', () => {
      const { labels, apply } = complete('twig', `{{ path('blog_archive', {year: 2024, mo‸}) }}`);
      expect(labels).toEqual(['month']);
      expect(apply('month')).toBe(`{{ path('blog_archive', {year: 2024, month}) }}`);
    });

    it('offers the remaining variables after a comma', () => {
      expect(complete('twig', `{{ url('blog_archive', {month: 1, ‸}) }}`).labels).toEqual(['year']);
    });

    it('completes a quoted key', () => {
      const { apply } = complete('twig', `{{ path('admin_export', {'fo‸'}) }}`.replace("{'fo‸'}", "{'fo‸': 'csv'}"));
      expect(apply('format')).toBe(`{{ path('admin_export', {'format': 'csv'}) }}`);
    });
  });

  describe('in PHP', () => {
    it('inserts a quoted key in an empty array', () => {
      const { labels, apply } = complete('php', `<?php $this->redirectToRoute('blog_show', [‸]);`);
      expect(labels).toEqual(['slug']);
      expect(apply('slug')).toBe(`<?php $this->redirectToRoute('blog_show', ['slug' => ]);`);
    });

    it('completes a key string being typed', () => {
      const { apply } = complete('php', `<?php $this->generateUrl('blog_archive', ['year' => 2024, 'm‸']);`);
      expect(apply('month')).toBe(`<?php $this->generateUrl('blog_archive', ['year' => 2024, 'month']);`);
    });

    it('works with a named parameters argument', () => {
      expect(complete('php', `<?php $this->redirectToRoute('blog_show', parameters: [‸]);`).labels).toEqual(['slug']);
    });
  });

  it.each<[string, DocumentLanguage, string]>([
    ['in a value', 'twig', `{{ path('blog_show', {slug: 'he‸llo'}) }}`],
    ['after a key, before its value', 'twig', `{{ path('blog_show', {slug: ‸}) }}`],
    ['after =>, before the value', 'php', `<?php $this->redirectToRoute('blog_show', ['slug' => ‸]);`],
    ['outside the parameters', 'twig', `{{ path('blog_show', {slug: 'x'})‸ }}`],
    ['for an unknown route', 'twig', `{{ path('nope', {‸}) }}`],
    ['for a dynamic route name', 'twig', `{{ path(name, {‸}) }}`],
    ['in the parameters of another function', 'twig', `{{ asset('blog_show', {‸}) }}`],
  ])('offers nothing %s', (_label, language, source) => {
    expect(complete(language, source).labels).toBeNull();
  });

  it('offers nothing once every variable is used', () => {
    expect(complete('twig', `{{ path('blog_show', {slug: 'x', ‸}) }}`).labels).toEqual([]);
  });
});
