import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { provideRouteDiagnostics, ROUTE_NOT_FOUND } from '../../../src/features/routes/diagnostics';
import { RouteReferenceFinder } from '../../../src/features/routes/RouteReferenceFinder';
import { RouteIndex } from '../../../src/index/RouteIndex';
import type { DocumentLanguage, Parsers } from '../../../src/parsing/parsers';
import { fixtureApp, loadParsers } from '../../helpers';

describe('route diagnostics', () => {
  let parsers: Parsers;
  let finder: RouteReferenceFinder;
  let index: RouteIndex;
  const temporaryDirs: string[] = [];

  beforeAll(async () => {
    parsers = await loadParsers();
    finder = new RouteReferenceFinder(parsers);
    index = new RouteIndex(fixtureApp, parsers);
  });

  afterEach(() => {
    temporaryDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  });

  function flagged(language: DocumentLanguage, text: string, routes = index): string[] {
    const document = TextDocument.create('file:///x', language, 1, text);
    const tree = parsers.parse(language, text)!;
    const references = finder.find(language, tree.rootNode);
    tree.delete();
    return provideRouteDiagnostics(document, references, routes).map((diagnostic) => {
      expect(diagnostic.code).toBe(ROUTE_NOT_FOUND);
      return text.slice(document.offsetAt(diagnostic.range.start), document.offsetAt(diagnostic.range.end));
    });
  }

  it('flags unknown routes in Twig and PHP, with the literal as range', () => {
    expect(flagged('twig', `{{ path('nope') }}\r\n<a href="{{ url("blog_sohw", {slug: 'x'}) }}">`)).toEqual([`'nope'`, `"blog_sohw"`]);
    expect(flagged('php', `<?php\n$this->redirectToRoute('nope');\n$this->generateUrl('nope_either');`)).toEqual([`'nope'`, `'nope_either'`]);
  });

  it('gives a precise message', () => {
    const document = TextDocument.create('file:///x', 'twig', 1, `{{ path('nope') }}`);
    const tree = parsers.parse('twig', document.getText())!;
    const [diagnostic] = provideRouteDiagnostics(document, finder.find('twig', tree.rootNode), index);
    tree.delete();
    expect(diagnostic?.message).toBe('Route "nope" not found.');
  });

  it.each<[string, DocumentLanguage, string]>([
    ['attribute routes', 'twig', `{{ path('blog_show', {slug: 'x'}) }}{{ path('blog_app_blog_feed') }}`],
    ['prefixed imported routes', 'php', `<?php $this->redirectToRoute('admin_export', ['format' => 'csv']);`],
    ['YAML routes, their aliases and when@dev', 'twig', `{{ path('legacy_contact') }}{{ path('contact') }}{{ path('dev_tools', {tool: 'x'}) }}`],
    ['bundle routes from the cache', 'twig', `{{ path('_profiler', {token: 't'}) }}{{ path('acme_ping') }}`],
    ['a dynamic name', 'twig', `{{ path('blog_' ~ kind) }}{{ path(route) }}`],
    ['an empty literal being typed', 'twig', `{{ path('') }}`],
    ['another function', 'twig', `{{ asset('nope') }}`],
  ])('does not flag %s', (_label, language, text) => {
    expect(flagged(language, text)).toEqual([]);
  });

  it('stays silent when the routes of the project are not all known', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'symfony-zed-'));
    temporaryDirs.push(tmp);
    fs.writeFileSync(path.join(tmp, 'composer.json'), '{}');
    // No var/cache/dev/url_generating_routes.php: bundle routes are unknown.
    expect(flagged('twig', `{{ path('nope') }}`, new RouteIndex(tmp, parsers))).toEqual([]);
  });

  it('follows an open controller: a route added there is known at once', () => {
    const local = new RouteIndex(fixtureApp, parsers);
    expect(flagged('twig', `{{ path('blog_new') }}`, local)).toEqual([`'blog_new'`]);
    const file = path.join(fixtureApp, 'src', 'Controller', 'BlogController.php');
    const edited = fs.readFileSync(file, 'utf8').replace("#[Route('', name: 'index'", "#[Route('/new', name: 'new')]\n    #[Route('', name: 'index'");
    local.updatePhpFile(file, edited);
    expect(flagged('twig', `{{ path('blog_new') }}`, local)).toEqual([]);
  });
});
