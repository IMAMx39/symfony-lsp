import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TemplateIndex } from '../../src/index/TemplateIndex';
import { MAIN_NAMESPACE, TwigLoaderPaths } from '../../src/project/TwigLoaderPaths';
import { fixtureApp, loadParsers } from '../helpers';

describe('TemplateIndex', () => {
  let fixtureIndex: TemplateIndex;

  beforeAll(async () => {
    fixtureIndex = new TemplateIndex(TwigLoaderPaths.build(fixtureApp, await loadParsers()).namespaces);
  });

  const names = (index: TemplateIndex): string[] => index.templates().map((template) => template.name).sort();

  it('lists every reachable template of the fixture, with its namespace', () => {
    expect(names(fixtureIndex)).toEqual([
      '@!AcmeFoo/layout.html.twig',
      '@!AcmeFoo/widget.html.twig',
      '@!AcmeLegacy/index.html.twig',
      '@AcmeFoo/layout.html.twig',
      '@AcmeFoo/widget.html.twig',
      '@AcmeLegacy/index.html.twig',
      '@Dev/toolbar.html.twig',
      '@Lib/card.html.twig',
      'admin/dashboard.html.twig',
      'base.html.twig',
      'form_div_layout.html.twig',
      'home/_hero.html.twig',
      'home/index.html.twig',
      'macros.html.twig',
      'priority.html.twig',
      'shared_only.html.twig',
    ]);
  });

  it('keeps the first file of a namespace for a shadowed name', () => {
    const priority = fixtureIndex.templates().find((template) => template.name === 'priority.html.twig');
    expect(priority?.file).toBe(path.join(fixtureApp, 'shared', 'templates', 'priority.html.twig'));
    const layout = fixtureIndex.templates().find((template) => template.name === '@AcmeFoo/layout.html.twig');
    expect(layout?.file).toBe(path.join(fixtureApp, 'templates', 'bundles', 'AcmeFooBundle', 'layout.html.twig'));
  });

  it('does not list bundle overrides under the main namespace', () => {
    expect(names(fixtureIndex).some((name) => name.startsWith('bundles/'))).toBe(false);
  });

  describe('refresh', () => {
    let tmp: string;
    let templates: string;
    let index: TemplateIndex;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'symfony-zed-'));
      templates = path.join(tmp, 'templates');
      fs.mkdirSync(path.join(templates, 'home'), { recursive: true });
      fs.writeFileSync(path.join(templates, 'base.html.twig'), '');
      index = new TemplateIndex(new Map([[MAIN_NAMESPACE, [templates]]]));
    });

    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('picks up created and deleted templates', () => {
      const created = path.join(templates, 'home', 'new.html.twig');
      fs.writeFileSync(created, '');
      expect(index.refresh(created)).toBe(true);
      expect(names(index)).toEqual(['base.html.twig', 'home/new.html.twig']);

      fs.rmSync(created);
      expect(index.refresh(created)).toBe(true);
      expect(names(index)).toEqual(['base.html.twig']);
    });

    it('ignores files outside every namespace', () => {
      expect(index.refresh(path.join(tmp, 'elsewhere', 'x.html.twig'))).toBe(false);
    });

    it('only lists .twig files', () => {
      fs.writeFileSync(path.join(templates, 'logo.svg'), '');
      expect(index.refresh(path.join(templates, 'logo.svg'))).toBe(true);
      expect(names(index)).toEqual(['base.html.twig']);
    });
  });
});
