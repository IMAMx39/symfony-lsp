import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseTemplateName, TemplateResolver } from '../../src/project/TemplateResolver';
import { MAIN_NAMESPACE } from '../../src/project/TwigLoaderPaths';
import { fixtureApp, fixtureResolver } from '../helpers';

const fixture = (...segments: string[]): string => path.join(fixtureApp, ...segments);

describe('parseTemplateName', () => {
  it('normalizes slashes like Twig', () => {
    expect(parseTemplateName('home//index.html.twig')).toEqual({ namespace: MAIN_NAMESPACE, segments: ['home', 'index.html.twig'] });
    expect(parseTemplateName('home\\index.html.twig')?.segments).toEqual(['home', 'index.html.twig']);
    expect(parseTemplateName('./home/index.html.twig')?.segments).toEqual(['home', 'index.html.twig']);
  });

  it('extracts namespaces, including the @! form', () => {
    expect(parseTemplateName('@Foo/bar/baz.html.twig')).toEqual({ namespace: 'Foo', segments: ['bar', 'baz.html.twig'] });
    expect(parseTemplateName('@!Foo/bar.html.twig')).toEqual({ namespace: '!Foo', segments: ['bar.html.twig'] });
    expect(parseTemplateName('@Foo//bar.html.twig')?.segments).toEqual(['bar.html.twig']);
  });

  it.each(['', '/', '../base.html.twig', 'a/../../b.twig', '@Foo', '@/bar.html.twig', '@Foo/', 'a\0b'])('rejects %j', (name) => {
    expect(parseTemplateName(name)).toBeNull();
  });
});

describe('TemplateResolver', () => {
  let resolver: TemplateResolver;

  beforeAll(async () => {
    resolver = await fixtureResolver();
  });

  it.each([
    ['base.html.twig', ['templates', 'base.html.twig']],
    ['shared_only.html.twig', ['shared', 'templates', 'shared_only.html.twig']],
    ['priority.html.twig', ['shared', 'templates', 'priority.html.twig']],
    ['form_div_layout.html.twig', ['vendor', 'symfony', 'twig-bridge', 'Resources', 'views', 'Form', 'form_div_layout.html.twig']],
    ['@Lib/card.html.twig', ['lib', 'templates', 'card.html.twig']],
    ['@Dev/toolbar.html.twig', ['dev', 'templates', 'toolbar.html.twig']],
    ['@AcmeFoo/layout.html.twig', ['templates', 'bundles', 'AcmeFooBundle', 'layout.html.twig']],
    ['@!AcmeFoo/layout.html.twig', ['vendor', 'acme', 'foo-bundle', 'templates', 'layout.html.twig']],
    ['@AcmeFoo/widget.html.twig', ['vendor', 'acme', 'foo-bundle', 'templates', 'widget.html.twig']],
    ['@!AcmeFoo/widget.html.twig', ['vendor', 'acme', 'foo-bundle', 'templates', 'widget.html.twig']],
    ['@AcmeLegacy/index.html.twig', ['vendor', 'acme', 'legacy-bundle', 'Resources', 'views', 'index.html.twig']],
  ])('resolves %s', (name, expected) => {
    expect(resolver.resolve(name)).toBe(fixture(...expected));
  });

  it.each([
    ['a namespaced path without its namespace', 'card.html.twig'],
    ['a prod-only namespace', '@Prod/banner.html.twig'],
    ['a test-only bundle', '@AcmeTestOnly/index.html.twig'],
    ['@email without symfony/mailer', '@email/zurb_2/notification/body.html.twig'],
    ['a bundle namespace with its Bundle suffix', '@AcmeFooBundle/layout.html.twig'],
    ['an unknown namespace', '@Foo/bar.html.twig'],
    ['a main template through a namespace', '@AcmeFoo/base.html.twig'],
  ])('does not resolve %s', (_label, name) => {
    expect(resolver.resolve(name)).toBeNull();
  });

  it('tries the directories of a namespace in order', () => {
    const ordered = new TemplateResolver(new Map([[MAIN_NAMESPACE, [fixture('missing-root'), fixture('templates')]]]));
    expect(ordered.resolve('base.html.twig')).toBe(fixture('templates', 'base.html.twig'));
  });

  it('is case-sensitive on every platform', () => {
    expect(resolver.resolve('BASE.html.twig')).toBeNull();
    expect(resolver.resolve('@acmeFoo/layout.html.twig')).toBeNull();
  });
});
