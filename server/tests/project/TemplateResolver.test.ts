import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitTemplateName, TemplateResolver } from '../../src/project/TemplateResolver';
import { fixtureApp } from '../helpers';

describe('splitTemplateName', () => {
  it('normalizes slashes like Twig', () => {
    expect(splitTemplateName('home//index.html.twig')).toEqual(['home', 'index.html.twig']);
    expect(splitTemplateName('home\\index.html.twig')).toEqual(['home', 'index.html.twig']);
    expect(splitTemplateName('./home/index.html.twig')).toEqual(['home', 'index.html.twig']);
  });

  it.each(['', '/', '../base.html.twig', 'a/../../b.twig', '@Foo/bar.html.twig'])('rejects %j', (name) => {
    expect(splitTemplateName(name)).toBeNull();
  });
});

describe('TemplateResolver', () => {
  const templates = path.join(fixtureApp, 'templates');

  it('returns the first root containing the template', () => {
    const resolver = new TemplateResolver([path.join(fixtureApp, 'missing-root'), templates]);
    expect(resolver.resolve('base.html.twig')).toBe(path.join(templates, 'base.html.twig'));
  });

  it('is case-sensitive on every platform', () => {
    expect(new TemplateResolver([templates]).resolve('BASE.html.twig')).toBeNull();
  });
});
