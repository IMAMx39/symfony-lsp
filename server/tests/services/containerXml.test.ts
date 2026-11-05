import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findContainerXml, parseContainerXml } from '../../src/services/containerXml';
import { isSamePath } from '../../src/util/paths';
import { fixtureApp } from '../helpers';

const fixtureCache = path.join(fixtureApp, 'var', 'cache', 'dev');

describe('parseContainerXml', () => {
  const { services, parameters } = parseContainerXml(fs.readFileSync(path.join(fixtureCache, 'App_KernelDevDebugContainer.xml'), 'utf8'))!;
  const byId = new Map(services.map((service) => [service.id, service]));
  const byName = new Map(parameters.map((parameter) => [parameter.name, parameter]));

  it('reads the top-level services with their class', () => {
    expect(byId.get('App\\Service\\Mailer')).toEqual({ id: 'App\\Service\\Mailer', class: 'App\\Service\\Mailer', alias: null, location: null });
    expect(byId.get('mailer.transport')?.class).toBe('Acme\\FooBundle\\Mailer\\Transport');
  });

  it('strips the leading backslash of a class', () => {
    expect(byId.get('logger')?.class).toBe('Symfony\\Component\\HttpKernel\\Log\\Logger');
  });

  it('reads aliases', () => {
    expect(byId.get('Psr\\Log\\LoggerInterface')).toEqual({ id: 'Psr\\Log\\LoggerInterface', class: null, alias: 'logger', location: null });
  });

  it('skips inline services nested in arguments', () => {
    expect(services.some((service) => service.class === 'App\\Service\\InlineHelper')).toBe(false);
  });

  it('keeps hidden ids (filtered by the index)', () => {
    expect(byId.has('.service_locator.Xyz123')).toBe(true);
  });

  it('reads the top-level parameters, collections without value', () => {
    expect(byName.get('kernel.project_dir')).toEqual({ name: 'kernel.project_dir', value: '/var/www/html', location: null });
    expect(byName.get('kernel.secret')?.value).toBe('%env(APP_SECRET)%');
    expect(byName.get('app.empty')?.value).toBe('');
    expect(byName.get('kernel.enabled_locales')?.value).toBeNull();
    expect(byName.has('FrameworkBundle')).toBe(false);
    expect(byName.has('.kernel.bundles_definition')).toBe(true);
  });

  it('handles a container with a single service or none', () => {
    expect(parseContainerXml('<container><services><service id="a" class="A\\B"/></services></container>')).toEqual({
      services: [{ id: 'a', class: 'A\\B', alias: null, location: null }],
      parameters: [],
    });
    expect(parseContainerXml('<container><services/></container>')).toEqual({ services: [], parameters: [] });
  });

  it('rejects what is not a dumped container', () => {
    expect(parseContainerXml('<routes><route id="x"/></routes>')).toBeNull();
    expect(parseContainerXml('not xml at all')).toBeNull();
  });
});

describe('findContainerXml', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symfony-zed-container-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('finds the dumped container of the fixture', () => {
    expect(isSamePath(findContainerXml(fixtureCache)!, path.join(fixtureCache, 'App_KernelDevDebugContainer.xml'))).toBe(true);
  });

  it('prefers the most recent dump', () => {
    const old = path.join(dir, 'Old_KernelDevDebugContainer.xml');
    const recent = path.join(dir, 'App_KernelDevDebugContainer.xml');
    fs.writeFileSync(old, '<container/>');
    fs.writeFileSync(recent, '<container/>');
    fs.utimesSync(old, new Date(2020, 0, 1), new Date(2020, 0, 1));
    fs.writeFileSync(path.join(dir, 'App_KernelDevDebugContainerCompiler.log'), '');
    expect(isSamePath(findContainerXml(dir)!, recent)).toBe(true);
  });

  it('returns null without a cache directory or a dump', () => {
    expect(findContainerXml(path.join(dir, 'missing'))).toBeNull();
    expect(findContainerXml(dir)).toBeNull();
  });
});
