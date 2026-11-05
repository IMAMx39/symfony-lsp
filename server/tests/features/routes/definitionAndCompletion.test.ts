import * as path from 'node:path';
import type { TextEdit } from 'vscode-languageserver';
import { beforeAll, describe, expect, it } from 'vitest';
import { provideRouteNameCompletion } from '../../../src/features/routes/completion';
import { provideRouteDefinition } from '../../../src/features/routes/definition';
import type { DocumentLanguage } from '../../../src/parsing/parsers';
import { isSamePath, uriToPath } from '../../../src/util/paths';
import { fixtureApp } from '../../helpers';
import { routeTestContext, type RouteTestContext } from './routes.helpers';

describe('route definition', () => {
  let ctx: RouteTestContext;

  beforeAll(async () => {
    ctx = await routeTestContext();
  });

  function definition(language: DocumentLanguage, source: string): { file: string; line: number } | null {
    const { document, offset, references } = ctx.at(language, source);
    const location = provideRouteDefinition(document, document.positionAt(offset), references, ctx.index);
    return location && { file: uriToPath(location.uri), line: location.range.start.line };
  }

  const blogController = path.join(fixtureApp, 'src', 'Controller', 'BlogController.php');

  it.each<[string, DocumentLanguage, string]>([
    ['path()', 'twig', `{{ path('blog_sh|ow', {slug: 'x'}) }}`],
    ['url()', 'twig', `<a href="{{ url("blog_show|") }}">`],
    ['redirectToRoute()', 'php', `<?php $this->redirectToRoute('blog_show|', ['slug' => 'x']);`],
    ['generateUrl()', 'php', `<?php $this->generateUrl(|'blog_show');`],
  ])('goes to the #[Route] attribute from %s', (_label, language, source) => {
    const target = definition(language, source);
    expect(target && isSamePath(target.file, blogController)).toBe(true);
    expect(target?.line).toBe(17);
  });

  it('goes to the YAML key of a YAML route, and of its alias', () => {
    for (const name of ['legacy_cont|act', 'cont|act']) {
      const target = definition('twig', `{{ path('${name}') }}`);
      expect(target && isSamePath(target.file, path.join(fixtureApp, 'config', 'routes.yaml'))).toBe(true);
      expect(target?.line).toBe(12);
    }
  });

  it('goes to the controller method of a route only known from the cache', () => {
    const target = definition('twig', `{{ path('acme_pi|ng') }}`);
    expect(target && isSamePath(target.file, path.join(fixtureApp, 'vendor', 'acme', 'foo-bundle', 'src', 'Controller', 'PingController.php'))).toBe(true);
  });

  it.each<[string, DocumentLanguage, string]>([
    ['an unknown route', 'twig', `{{ path('nope|') }}`],
    ['a service controller', 'twig', `{{ path('_profil|er', {token: 't'}) }}`],
    ['a dynamic name', 'twig', `{{ path('blog_' ~ na|me) }}`],
    ['a variable', 'php', `<?php $this->redirectToRoute($rou|te);`],
    ['another function', 'twig', `{{ asset('blog_sh|ow') }}`],
    ['another method', 'php', `<?php $router->generate('blog_sh|ow');`],
    ['the parameters', 'twig', `{{ path('blog_show', {slug: 'blog_sh|ow'}) }}`],
  ])('returns nothing for %s', (_label, language, source) => {
    expect(definition(language, source)).toBeNull();
  });
});

describe('route name completion', () => {
  let ctx: RouteTestContext;

  beforeAll(async () => {
    ctx = await routeTestContext();
  });

  function complete(language: DocumentLanguage, source: string) {
    const { document, offset, references } = ctx.at(language, source);
    const items = provideRouteNameCompletion(document, document.positionAt(offset), references, ctx.index.visibleRoutes());
    const apply = (label: string): string => {
      const edit = items?.find((item) => item.label === label)?.textEdit as TextEdit;
      const text = document.getText();
      return text.slice(0, document.offsetAt(edit.range.start)) + edit.newText + text.slice(document.offsetAt(edit.range.end));
    };
    return { items, apply };
  }

  it.each<[string, DocumentLanguage, string]>([
    ['path()', 'twig', `{{ path('|') }}`],
    ['url() with parameters', 'twig', `{{ url('b|', {slug: 'x'}) }}`],
    ['redirectToRoute()', 'php', `<?php return $this->redirectToRoute('|');`],
    ['generateUrl()', 'php', `<?php $this->generateUrl("|");`],
  ])('offers route names in %s', (_label, language, source) => {
    const labels = (complete(language, source).items ?? []).map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(['blog_show', 'admin_export', 'legacy_contact', '_profiler', 'acme_ping']));
    expect(labels).not.toContain('contact');
    expect(labels.some((label) => label.includes('::'))).toBe(false);
  });

  it('describes each route and replaces the whole literal', () => {
    const { items, apply } = complete('twig', `{{ path('blog|_sh') }}`);
    const show = items?.find((item) => item.label === 'blog_archive');
    expect(show?.detail).toBe('/blog/{year}/{month}');
    expect(apply('blog_show')).toBe(`{{ path('blog_show') }}`);
  });

  it('sorts internal routes (_profiler…) after application routes', () => {
    const items = complete('twig', `{{ path('|') }}`).items ?? [];
    const sorted = [...items].sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? ''));
    expect(String(sorted[sorted.length - 1]?.label)).toMatch(/^_/);
  });

  it('offers nothing outside a route name', () => {
    expect(complete('twig', `{{ path('blog_show', {slug: '|'}) }}`).items).toBeNull();
    expect(complete('php', `<?php $this->render('|');`).items).toBeNull();
  });
});
