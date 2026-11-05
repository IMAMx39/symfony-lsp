import { beforeAll, describe, expect, it } from 'vitest';
import type { MarkupContent } from 'vscode-languageserver';
import { provideRouteHover } from '../../../src/features/routes/hover';
import type { DocumentLanguage } from '../../../src/parsing/parsers';
import { fixtureApp } from '../../helpers';
import { routeTestContext, type RouteTestContext } from './routes.helpers';

describe('route hover', () => {
  let ctx: RouteTestContext;

  beforeAll(async () => {
    ctx = await routeTestContext();
  });

  function hover(language: DocumentLanguage, source: string): string | null {
    const { document, offset, references } = ctx.at(language, source);
    const result = provideRouteHover(document, document.positionAt(offset), references, ctx.index, fixtureApp);
    return result === null ? null : (result.contents as MarkupContent).value;
  }

  it('shows methods, path, controller and declaration of an attribute route', () => {
    expect(hover('twig', `{{ path('blog_arch|ive', {year: 2024}) }}`)).toBe(
      [
        '**blog_archive**',
        '```text\nGET /blog/{year}/{month}\n```',
        'Controller: `App\\Controller\\BlogController::archive`',
        'Defined in `src/Controller/BlogController.php:24`',
      ].join('\n\n'),
    );
  });

  it('shows ANY for a route without method restriction, from PHP', () => {
    expect(hover('php', `<?php $this->redirectToRoute('blog_sh|ow');`)).toContain('```text\nANY /blog/{slug}\n```');
  });

  it('shows the prefixed path of an imported invokable controller', () => {
    expect(hover('twig', `{{ path('admin_ex|port', {format: 'csv'}) }}`)).toContain('POST /admin/export/{format}');
  });

  it('names the target of an alias', () => {
    expect(hover('twig', `{{ path('cont|act') }}`)).toMatch(/^\*\*contact\*\* → alias of \*\*legacy_contact\*\*/);
  });

  it('describes cache-only routes, located through their controller', () => {
    const text = hover('twig', `{{ path('acme_pi|ng') }}`);
    expect(text).toContain('GET|HEAD /_acme/ping');
    expect(text).toContain('Defined in `vendor/acme/foo-bundle/src/Controller/PingController.php:10`');
    expect(hover('twig', `{{ path('_profil|er', {token: 'x'}) }}`)).toBe(
      ['**_profiler**', '```text\nANY /_profiler/{token}\n```', 'Controller: `web_profiler.controller.profiler::panelAction`'].join('\n\n'),
    );
  });

  it('returns nothing for unknown routes or outside a route name', () => {
    expect(hover('twig', `{{ path('nop|e') }}`)).toBeNull();
    expect(hover('twig', `{{ path('blog_show', {slug: 'blo|g'}) }}`)).toBeNull();
  });
});
