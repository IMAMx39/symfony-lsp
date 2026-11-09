import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ServiceIndex, serviceFileKind } from '../../src/index/ServiceIndex';
import type { Parsers } from '../../src/parsing/parsers';
import { isSamePath, uriToPath } from '../../src/util/paths';
import { fixtureApp, loadParsers } from '../helpers';

const fixture = (...segments: string[]): string => path.join(fixtureApp, ...segments);

describe('ServiceIndex', () => {
  let parsers: Parsers;
  let index: ServiceIndex;

  beforeAll(async () => {
    parsers = await loadParsers();
    index = new ServiceIndex(fixtureApp, parsers);
  });

  it('merges the compiled container and the YAML declarations, without hidden ids', () => {
    expect(index.hasContainer()).toBe(true);
    expect(index.visibleServices().map((service) => service.id).sort()).toEqual([
      'App\\EventSubscriber\\OrderSubscriber',
      'App\\MessageHandler\\CreateOrderHandler',
      'App\\MessageHandler\\StaleHandler',
      'App\\Service\\Mailer',
      'App\\Service\\Newsletter',
      'Psr\\Log\\LoggerInterface',
      'acme_foo.audit_handler',
      'acme_foo.cancel_logger',
      'acme_foo.locale_listener',
      'app.child_mailer',
      'app.debug_mailer',
      'app.mailer',
      'app.mailer.public',
      'app.mailer_short',
      'app.newsletter',
      'compiled.only',
      'debug.event_dispatcher',
      'debug.security.event_dispatcher.main',
      'logger',
      'mailer.transport',
      'service_container',
    ]);
    expect(index.get('.service_locator.Xyz123')).toBeDefined();
  });

  it('merges parameters: compiled value, YAML location, hidden ones left out', () => {
    expect(index.getParameter('app.sender')).toMatchObject({ value: 'noreply@example.com' });
    expect(index.getParameter('app.sender')?.location?.range.start).toEqual({ line: 1, character: 4 });
    expect(index.getParameter('app.not_a_reference')).toMatchObject({ value: '@app.mailer' });
    expect(index.getParameter('kernel.project_dir')).toMatchObject({ value: '/var/www/html', location: null });
    expect(index.visibleParameters().some((parameter) => parameter.name.startsWith('.'))).toBe(false);
    expect(index.getParameter('.kernel.bundles_definition')).toBeDefined();
  });

  it('merges compiled and YAML tags, resolves alias chains and lists aliases', () => {
    const local = new ServiceIndex(fixtureApp, parsers);
    local.updateYamlFile(fixture('config', 'services.yaml'), 'services:\n    app.newsletter:\n        class: App\\Service\\Newsletter\n        tags: [app.new_tag, app.tag]\n');
    expect(local.get('app.newsletter')?.tags).toEqual(['app.tag', 'kernel.event_listener', 'app.named_tag', 'app.new_tag']);
    expect(index.resolve(index.get('app.mailer_short')!)?.id).toBe('App\\Service\\Mailer');
    expect(index.resolve(index.get('logger')!)?.id).toBe('logger');
    expect(index.aliasesOf('logger').map((service) => service.id)).toEqual(['Psr\\Log\\LoggerInterface']);
  });

  it('takes the class of a child definition from the container', () => {
    expect(index.get('app.child_mailer')?.class).toBe('App\\Service\\Newsletter');
  });

  it('locates a YAML-declared service on its key', () => {
    const location = index.locationOf(index.get('app.newsletter')!)!;
    expect(isSamePath(uriToPath(location.uri), fixture('config', 'services.yaml'))).toBe(true);
    expect(location.range.start.character).toBe(4);
  });

  it('locates a container-only service on its class, through aliases', () => {
    for (const id of ['compiled.only', 'app.mailer.public']) {
      const location = index.locationOf(index.get(id)!)!;
      expect(isSamePath(uriToPath(location.uri), fixture('src', 'Service', 'Newsletter.php'))).toBe(true);
      expect(location.range.start).toEqual({ line: 4, character: 6 });
    }
  });

  it('locates a bundle service through the PSR-4 of installed.json', () => {
    const location = index.locationOf(index.get('mailer.transport')!)!;
    expect(isSamePath(uriToPath(location.uri), fixture('vendor', 'acme', 'foo-bundle', 'src', 'Mailer', 'Transport.php'))).toBe(true);
  });

  it('returns null when the class file is not found', () => {
    expect(index.locationOf(index.get('logger')!)).toBeNull();
    expect(index.locationOf(index.get('Psr\\Log\\LoggerInterface')!)).toBeNull();
  });

  it('lets an open document override its file, and keeps the last valid content', () => {
    const local = new ServiceIndex(fixtureApp, parsers);
    const file = fixture('config', 'services.yaml');
    expect(local.updateYamlFile(file, 'services:\n    app.added: { class: App\\Service\\Mailer }\n')).toBe(true);
    expect(local.get('app.added')?.class).toBe('App\\Service\\Mailer');
    expect(local.get('app.debug_mailer')).toBeUndefined();
    local.updateYamlFile(file, 'services:\n    app.added: [\n');
    expect(local.get('app.added')).toBeDefined();
    local.updateYamlFile(file, null);
    expect(local.get('app.added')).toBeUndefined();
    expect(local.get('app.debug_mailer')).toBeDefined();
    expect(local.updateYamlFile(fixture('config', 'packages', 'twig.yaml'), 'services: {}')).toBe(false);
  });

  describe('without compiled container', () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symfony-zed-services-'));
      fs.mkdirSync(path.join(dir, 'config'));
      fs.writeFileSync(path.join(dir, 'config', 'services.yaml'), 'services:\n    app.only_yaml: ~\n');
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('keeps the YAML declarations', () => {
      const local = new ServiceIndex(dir, parsers);
      expect(local.hasContainer()).toBe(false);
      expect(local.visibleServices().map((service) => service.id)).toEqual(['app.only_yaml']);
    });

    const dumpContainer = (services: string): void => {
      const cache = path.join(dir, 'var', 'cache', 'dev');
      fs.mkdirSync(cache, { recursive: true });
      fs.writeFileSync(path.join(cache, 'App_KernelDevDebugContainer.xml'), `<container><services>${services}</services></container>`);
    };

    it('stops on alias cycles of the container', () => {
      dumpContainer('<service id="a" alias="b"/><service id="b" alias="a"/>');
      const local = new ServiceIndex(dir, parsers);
      expect(local.locationOf(local.get('a')!)).toBeNull();
    });

    it('picks the container up once dumped', () => {
      const local = new ServiceIndex(dir, parsers);
      dumpContainer('<service id="logger" class="Logger"/>');
      local.reloadContainer();
      expect(local.get('logger')).toBeDefined();
    });
  });
});

describe('serviceFileKind', () => {
  it('classifies the files the services depend on', () => {
    expect(serviceFileKind(fixture('config', 'services.yaml'), fixtureApp)).toBe('services-config');
    expect(serviceFileKind(fixture('config', 'services_dev.yaml'), fixtureApp)).toBe('services-config');
    expect(serviceFileKind(fixture('var', 'cache', 'dev', 'App_KernelDevDebugContainer.xml'), fixtureApp)).toBe('container');
    expect(serviceFileKind(fixture('config', 'services_prod.yaml'), fixtureApp)).toBeNull();
    expect(serviceFileKind(fixture('var', 'cache', 'prod', 'App_KernelProdContainer.xml'), fixtureApp)).toBeNull();
    expect(serviceFileKind(fixture('config', 'packages', 'twig.yaml'), fixtureApp)).toBeNull();
  });
});
