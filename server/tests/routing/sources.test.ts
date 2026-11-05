import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Parsers } from '../../src/parsing/parsers';
import { parseCompiledGeneratorRoutes, parseCompiledMatcherMethods } from '../../src/routing/compiledRoutes';
import { parseRouteYaml } from '../../src/routing/yamlRoutes';
import { fixtureApp, loadParsers } from '../helpers';

const fixture = (...segments: string[]): string => path.join(fixtureApp, ...segments);
const read = (...segments: string[]): string => fs.readFileSync(fixture(...segments), 'utf8');

describe('compiled routes', () => {
  let parsers: Parsers;

  beforeAll(async () => {
    parsers = await loadParsers();
  });

  it('reads names, paths and controllers of url_generating_routes.php', () => {
    const routes = parseCompiledGeneratorRoutes(read('var', 'cache', 'dev', 'url_generating_routes.php'), parsers);
    expect(routes?.map((route) => [route.name, route.path, route.controller])).toEqual([
      ['_wdt', '/_wdt/{token}', 'web_profiler.controller.profiler::toolbarAction'],
      ['_profiler', '/_profiler/{token}', 'web_profiler.controller.profiler::panelAction'],
      ['acme_ping', '/_acme/ping', 'Acme\\FooBundle\\Controller\\PingController::ping'],
      ['app_home', '/', 'App\\Controller\\HomeController::index'],
      ['blog_show', '/blog/{slug}', 'App\\Controller\\BlogController::show'],
      ['stale_route', '/stale', 'App\\Controller\\RemovedController::index'],
      ['App\\Controller\\HomeController::index', '/', 'App\\Controller\\HomeController::index'],
    ]);
  });

  it('reads static and dynamic route methods of url_matching_routes.php', () => {
    const methods = parseCompiledMatcherMethods(read('var', 'cache', 'dev', 'url_matching_routes.php'), parsers);
    expect(Object.fromEntries(methods ?? [])).toEqual({
      acme_ping: ['GET', 'HEAD'],
      app_home: [],
      _wdt: [],
      _profiler: [],
      blog_show: ['GET'],
    });
  });

  it('returns null for a file that is not a compiled route file', () => {
    expect(parseCompiledGeneratorRoutes('<?php echo 1;', parsers)).toBeNull();
  });
});

describe('parseRouteYaml', () => {
  it('reads routes, aliases, attribute imports and the when@dev block of the fixture', () => {
    const file = fixture('config', 'routes.yaml');
    const parsed = parseRouteYaml(read('config', 'routes.yaml'), file, 'dev');
    expect(parsed.complete).toBe(true);
    expect(parsed.routes.map((route) => [route.name, route.path, route.methods, route.controller])).toEqual([
      ['legacy_contact', '/contact', ['GET', 'POST'], 'App\\Controller\\HomeController::index'],
      ['dev_tools', '/_dev/tools/{tool}', [], 'App\\Controller\\HomeController::index'],
    ]);
    expect(parsed.routes[0]?.location?.range.start).toEqual({ line: 12, character: 0 });
    expect(parsed.aliases).toEqual([{ name: 'contact', target: 'legacy_contact' }]);
    expect(parsed.imports).toEqual([
      { target: fixture('src', 'Controller'), prefix: '', namePrefix: '' },
      { target: fixture('src', 'Admin', 'Controller'), prefix: '/admin', namePrefix: 'admin_' },
    ]);
  });

  it('ignores the when@ blocks of other environments', () => {
    const parsed = parseRouteYaml(read('config', 'routes.yaml'), fixture('config', 'routes.yaml'), 'prod');
    expect(parsed.routes.map((route) => route.name)).toEqual(['legacy_contact']);
  });

  it('leaves bundle and service resources to the compiled cache', () => {
    const source = [
      'controllers:',
      '    resource: routing.controllers',
      'profiler:',
      "    resource: '@WebProfilerBundle/Resources/config/routing/profiler.php'",
      '    prefix: /_profiler',
      '',
    ].join('\n');
    expect(parseRouteYaml(source, fixture('config', 'routes.yaml'), 'dev')).toEqual({ routes: [], imports: [], aliases: [], complete: true });
  });

  it.each([
    ['a localized path', 'home:\n    path: { en: /home, fr: /accueil }\n'],
    ['a glob import', 'c:\n    resource: ../src/Controller/*Controller.php\n    type: attribute\n'],
    ['a nested YAML import', 'c:\n    resource: admin.yaml\n    prefix: /admin\n'],
    ['invalid YAML', 'home: [unclosed\n'],
  ])('reports %s as incomplete', (_label, source) => {
    expect(parseRouteYaml(source, fixture('config', 'routes.yaml'), 'dev').complete).toBe(false);
  });
});
