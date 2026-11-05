import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RouteIndex, routeFileKind } from '../../src/index/RouteIndex';
import type { Parsers } from '../../src/parsing/parsers';
import { isSamePath, uriToPath } from '../../src/util/paths';
import { fixtureApp, loadParsers } from '../helpers';

const fixture = (...segments: string[]): string => path.join(fixtureApp, ...segments);

describe('RouteIndex', () => {
  let parsers: Parsers;
  let index: RouteIndex;

  beforeAll(async () => {
    parsers = await loadParsers();
    index = new RouteIndex(fixtureApp, parsers);
  });

  it('merges attributes, YAML and the compiled cache', () => {
    expect(index.visibleRoutes().map((route) => route.name).sort()).toEqual([
      '_profiler',
      '_wdt',
      'acme_ping',
      'admin_export',
      'app_dashboard',
      'app_hero',
      'app_home',
      'app_missing',
      'blog_app_blog_feed',
      'blog_archive',
      'blog_index',
      'blog_show',
      'dev_tools',
      'legacy_contact',
      'stale_route',
    ]);
    expect(index.isCertain()).toBe(true);
  });

  it('prefers the source declaration over the cache, and keeps cache methods when unknown', () => {
    const show = index.get('blog_show');
    expect(show?.methods).toEqual([]);
    expect(isSamePath(uriToPath(show!.location!.uri), fixture('src', 'Controller', 'BlogController.php'))).toBe(true);
  });

  it('applies the prefixes of the YAML import', () => {
    expect(index.get('admin_export')).toMatchObject({ path: '/admin/export/{format}', methods: ['POST'], controller: 'App\\Admin\\Controller\\ExportController' });
  });

  it('resolves aliases to their route without proposing them', () => {
    expect(index.get('contact')?.name).toBe('legacy_contact');
    expect(index.get('App\\Controller\\BlogController::show')?.name).toBe('blog_show');
    expect(index.visibleRoutes().map((route) => route.name)).not.toContain('contact');
    expect(index.visibleRoutes().some((route) => route.name.includes('::'))).toBe(false);
  });

  it('locates cache-only routes through their controller', () => {
    const ping = index.get('acme_ping')!;
    expect(ping.methods).toEqual(['GET', 'HEAD']);
    const location = index.locationOf(ping);
    expect(isSamePath(uriToPath(location!.uri), fixture('vendor', 'acme', 'foo-bundle', 'src', 'Controller', 'PingController.php'))).toBe(true);
    expect(location!.range.start.line).toBe(9);
    // Service controllers need the container.
    expect(index.locationOf(index.get('_profiler')!)).toBeNull();
    // A stale controller class that no longer exists.
    expect(index.locationOf(index.get('stale_route')!)).toBeNull();
  });

  it('lets an open document override its file', () => {
    const local = new RouteIndex(fixtureApp, parsers);
    const file = fixture('src', 'Controller', 'BlogController.php');
    const edited = fs.readFileSync(file, 'utf8').replace("name: 'index'", "name: 'home'");
    expect(local.updatePhpFile(file, edited)).toBe(true);
    expect(local.get('blog_home')).toBeDefined();
    expect(local.get('blog_index')).toBeUndefined();
    expect(local.updatePhpFile(file, edited)).toBe(false);
    expect(local.updatePhpFile(file, null)).toBe(true);
    expect(local.get('blog_index')).toBeDefined();
  });

  it('classifies changed files', () => {
    expect(routeFileKind(fixture('config', 'routes.yaml'), fixtureApp)).toBe('routing-config');
    expect(routeFileKind(fixture('config', 'routes', 'dev', 'x.yaml'), fixtureApp)).toBe('routing-config');
    expect(routeFileKind(fixture('var', 'cache', 'dev', 'url_matching_routes.php'), fixtureApp)).toBe('compiled');
    expect(routeFileKind(fixture('vendor', 'composer', 'installed.json'), fixtureApp)).toBe('autoload');
    expect(routeFileKind(fixture('src', 'Controller', 'X.php'), fixtureApp)).toBe('source');
    expect(routeFileKind(fixture('templates', 'x.html.twig'), fixtureApp)).toBeNull();
  });

  describe('certainty', () => {
    let tmp: string;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'symfony-zed-'));
      write('composer.json', '{}');
      write('var/cache/dev/url_generating_routes.php', "<?php return ['a' => [[], [], [], [['text', '/a']], [], [], []]];");
    });

    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    function write(relative: string, content: string): void {
      const file = path.join(tmp, ...relative.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }

    it('is certain with a cache and readable sources', () => {
      expect(new RouteIndex(tmp, parsers).isCertain()).toBe(true);
    });

    it('is not certain without the compiled cache', () => {
      fs.rmSync(path.join(tmp, 'var'), { recursive: true });
      expect(new RouteIndex(tmp, parsers).isCertain()).toBe(false);
    });

    it('is not certain with a PHP route configuration', () => {
      write('config/routes/admin.php', '<?php return static function () {};');
      expect(new RouteIndex(tmp, parsers).isCertain()).toBe(false);
    });

    it('is not certain with a route whose name is not a literal', () => {
      write('src/Controller/A.php', "<?php use Symfony\\Component\\Routing\\Attribute\\Route; class A { #[Route('/x', name: self::N)] public function x() {} }");
      expect(new RouteIndex(tmp, parsers).isCertain()).toBe(false);
    });
  });
});
