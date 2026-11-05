import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Parsers } from '../../src/parsing/parsers';
import { defaultRouteName, extractAttributeRoutes } from '../../src/routing/attributeRoutes';
import type { RouteExtraction } from '../../src/routing/types';
import { fixtureApp, loadParsers } from '../helpers';

const summary = ({ routes }: RouteExtraction): Array<[string, string | null, string | null, string]> =>
  routes.map((route) => [route.name, route.path, route.methods === null ? null : route.methods.join('|'), route.controller ?? '']);

describe('defaultRouteName', () => {
  it.each([
    ['App\\Controller\\BlogController', 'feedAction', 0, 'app_blog_feed'],
    ['App\\Controller\\HomeController', 'index', 1, 'app_home_index_1'],
    ['Acme\\DemoBundle\\Controller\\FooController', 'barAction', 0, 'acme_demo_foo_bar'],
    // PHP's str_replace('__', '_') is a single pass: `___invoke` becomes `__invoke`.
    ['App\\Controller\\Api\\LogController', '__invoke', 0, 'app_api_log__invoke'],
  ])('%s::%s (#%d) → %s', (className, method, index, expected) => {
    expect(defaultRouteName(className, method, index)).toBe(expected);
  });
});

describe('extractAttributeRoutes', () => {
  let parsers: Parsers;

  beforeAll(async () => {
    parsers = await loadParsers();
  });

  const extract = (source: string, prefixes: { prefix: string; namePrefix: string } | null = null): RouteExtraction =>
    extractAttributeRoutes(source, path.join(fixtureApp, 'src', 'X.php'), 'dev', parsers, prefixes);

  it('reads the fixture BlogController like Symfony', () => {
    const file = path.join(fixtureApp, 'src', 'Controller', 'BlogController.php');
    const extraction = extractAttributeRoutes(fs.readFileSync(file, 'utf8'), file, 'dev', parsers);
    expect(extraction.complete).toBe(true);
    expect(summary(extraction)).toEqual([
      ['blog_index', '/blog', 'GET', 'App\\Controller\\BlogController::index'],
      ['blog_show', '/blog/{slug}', '', 'App\\Controller\\BlogController::show'],
      ['blog_archive', '/blog/{year<\\d{4}>}/{month?1}', 'GET', 'App\\Controller\\BlogController::archive'],
      ['blog_app_blog_feed', '/blog/feed.{_format}', '', 'App\\Controller\\BlogController::feedAction'],
    ]);
    const show = extraction.routes[1]!;
    expect(show.aliases).toEqual(['App\\Controller\\BlogController::show']);
    expect(show.location?.range.start).toEqual({ line: 17, character: 6 });
  });

  it('numbers default names of a method with several routes', () => {
    const { routes } = extract(`<?php
namespace App\\Controller;
use Symfony\\Component\\Routing\\Attribute\\Route;
class PageController {
    #[Route('/a')]
    #[Route('/b', name: 'named')]
    #[Route('/c')]
    public function page() {}
}`);
    expect(routes.map((route) => route.name)).toEqual(['app_page_page', 'named', 'app_page_page_1']);
    // No `Class::method` alias when a method has several routes.
    expect(routes.every((route) => route.aliases.length === 0)).toBe(true);
  });

  it('uses class-level attributes for an invokable controller', () => {
    const { routes } = extract(
      `<?php
namespace App\\Admin;
use Symfony\\Component\\Routing\\Annotation\\Route;
#[Route('/export/{format}', name: 'export', methods: 'post')]
final class ExportController { public function __invoke() {} }`,
      { prefix: '/admin/', namePrefix: 'admin_' },
    );
    expect(summary({ routes, complete: true })).toEqual([['admin_export', '/admin/export/{format}', 'POST', 'App\\Admin\\ExportController']]);
    expect(routes[0]?.aliases).toEqual(['admin_App\\Admin\\ExportController', 'admin_App\\Admin\\ExportController::__invoke']);
  });

  it('merges class and method methods, and honours env', () => {
    const { routes } = extract(`<?php
use Symfony\\Component\\Routing\\Attribute\\Route;
#[Route('/api', methods: ['GET'])]
class Api {
    #[Route('/x', name: 'x', methods: ['POST'])] public function x() {}
    #[Route('/dev', name: 'dev_only', env: 'dev')] public function d() {}
    #[Route('/prod', name: 'prod_only', env: ['prod', 'staging'])] public function p() {}
}
#[Route('/never', env: 'prod')]
class ProdOnly { #[Route('/y', name: 'y')] public function y() {} }`);
    expect(summary({ routes, complete: true })).toEqual([
      ['x', '/api/x', 'GET|POST', 'Api::x'],
      ['dev_only', '/api/dev', 'GET', 'Api::d'],
    ]);
  });

  it.each([
    ['a constant name', `#[Route('/x', name: self::NAME)]`],
    ['a localized path', `#[Route(['en' => '/x', 'fr' => '/y'], name: 'x')]`],
    ['a dynamic env', `#[Route('/x', name: 'x', env: self::ENV)]`],
  ])('skips a route with %s and reports the file as incomplete', (_label, attribute) => {
    const extraction = extract(`<?php
use Symfony\\Component\\Routing\\Attribute\\Route;
class A { ${attribute} public function x() {} #[Route('/ok', name: 'ok')] public function ok() {} }`);
    expect(extraction.complete).toBe(false);
    expect(extraction.routes.map((route) => route.name)).toEqual(['ok']);
  });

  it('keeps routes with unknown methods, marked unknown', () => {
    const { routes, complete } = extract(`<?php
use Symfony\\Component\\Routing\\Attribute\\Route;
class A { #[Route('/x', name: 'x', methods: self::METHODS)] public function x() {} }`);
    expect(complete).toBe(true);
    expect(routes[0]?.methods).toBeNull();
  });

  it.each([
    ['an abstract class', `abstract class A { #[Route('/x', name: 'x')] public function x() {} }`],
    ['another Route attribute', `class A { #[\\App\\Attribute\\Route('/x', name: 'x')] public function x() {} }`],
    ['a file without routes', `class A { public function x() {} }`],
  ])('ignores %s', (_label, body) => {
    expect(extract(`<?php\nuse Symfony\\Component\\Routing\\Attribute\\Route as SymfonyRoute;\n${body}`)).toEqual({ routes: [], complete: true });
  });
});
