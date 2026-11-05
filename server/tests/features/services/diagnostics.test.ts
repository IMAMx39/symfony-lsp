import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Diagnostic } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AutowireReferenceFinder } from '../../../src/features/services/AutowireReferenceFinder';
import { provideServiceDiagnostics, SERVICE_NOT_FOUND } from '../../../src/features/services/diagnostics';
import { ServiceIndex } from '../../../src/index/ServiceIndex';
import type { Parsers } from '../../../src/parsing/parsers';
import { findServiceReferences } from '../../../src/services/yamlServices';
import { pathToUri } from '../../../src/util/paths';
import { fixtureApp, loadParsers } from '../../helpers';

const containerXml = path.join(fixtureApp, 'var', 'cache', 'dev', 'App_KernelDevDebugContainer.xml');
const servicesFile = path.join(fixtureApp, 'config', 'services.yaml');

const messageOf = (diagnostic: Diagnostic): string => (typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value);

/** Makes the fixture dump newer than its configuration, whatever the checkout order was. */
function freshDump(file = containerXml): void {
  const now = new Date();
  fs.utimesSync(file, now, now);
}

describe('service diagnostics', () => {
  let parsers: Parsers;
  let index: ServiceIndex;

  beforeAll(async () => {
    parsers = await loadParsers();
    freshDump();
    index = new ServiceIndex(fixtureApp, parsers);
  });

  const yamlDiagnostics = (source: string, serviceIndex = index) => {
    const document = TextDocument.create(pathToUri(servicesFile), 'yaml', 1, source);
    return provideServiceDiagnostics(document, findServiceReferences(source, 'dev'), serviceIndex);
  };
  const messages = (source: string): string[] => yamlDiagnostics(source).map(messageOf);
  const yaml = (...args: string[]) => `services:\n    foo:\n        arguments: [${args.join(', ')}]\n`;

  it('reports unknown services of the fixture, not the optional ones', () => {
    const diagnostics = yamlDiagnostics(fs.readFileSync(servicesFile, 'utf8'));
    expect(diagnostics.map(messageOf)).toEqual(['Service "unknown.service" not found.']);
    expect(diagnostics[0]).toMatchObject({ code: SERVICE_NOT_FOUND, severity: 2, source: 'symfony' });
  });

  it('covers the literal with the quotes', () => {
    const source = yaml("'@nope'");
    const [diagnostic] = yamlDiagnostics(source);
    const document = TextDocument.create('file:///x', 'yaml', 1, source);
    expect(source.slice(document.offsetAt(diagnostic!.range.start), document.offsetAt(diagnostic!.range.end))).toBe("'@nope'");
  });

  it('accepts known ids, optional references and classes that may be autoregistered', () => {
    expect(messages(yaml("'@logger'", "'@app.debug_mailer'", "'@?nope'", "'@!nope'", "'@'"))).toEqual([]);
    expect(messages(yaml("'@App\\Service\\Newsletter'", "'@App\\Kernel'"))).toEqual([]);
    expect(messages(yaml("'@App\\Service\\Missing'"))).toEqual(['Service "App\\Service\\Missing" not found.']);
  });

  it('accepts a service declared in the open document', () => {
    const local = new ServiceIndex(fixtureApp, parsers);
    const source = "services:\n    app.fresh: { class: App\\Service\\Mailer }\n    foo:\n        arguments: ['@app.fresh']\n";
    local.updateYamlFile(servicesFile, source);
    expect(yamlDiagnostics(source, local)).toEqual([]);
  });

  it('reports #[Autowire] services only on parameters that require them', () => {
    const finder = new AutowireReferenceFinder(parsers);
    const phpMessages = (parameter: string): string[] => {
      const source = `<?php\nuse Symfony\\Component\\DependencyInjection\\Attribute\\Autowire;\nclass T { public function __construct(${parameter}) {} }\n`;
      const tree = parsers.parse('php', source)!;
      const { services } = finder.find(tree.rootNode);
      tree.delete();
      const document = TextDocument.create(pathToUri(path.join(fixtureApp, 'src', 'T.php')), 'php', 1, source);
      return provideServiceDiagnostics(document, services, index).map(messageOf);
    };
    expect(phpMessages("#[Autowire(service: 'nope')] private Foo $a")).toEqual(['Service "nope" not found.']);
    expect(phpMessages("#[Autowire('@nope')] Foo $a")).toEqual(['Service "nope" not found.']);
    expect(phpMessages("#[Autowire(service: 'logger')] Foo $a")).toEqual([]);
    for (const parameter of [
      "#[Autowire(service: 'nope')] ?Foo $a",
      "#[Autowire(service: 'nope')] Foo|null $a",
      "#[Autowire(service: 'nope')] mixed $a",
      "#[Autowire(service: 'nope')] Foo $a = null",
      "#[Autowire(service: 'nope')] $a",
    ]) {
      expect(phpMessages(parameter), parameter).toEqual([]);
    }
  });

  describe('certainty', () => {
    let dir: string;
    const write = (relative: string, content: string): string => {
      const file = path.join(dir, ...relative.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      return file;
    };
    const past = new Date(2020, 0, 1);

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symfony-zed-service-diagnostics-'));
      const packages = write('config/packages/framework.yaml', 'framework: ~\n');
      fs.utimesSync(packages, past, past);
      write('config/services.yaml', 'services:\n    foo: ~\n');
      write('var/cache/dev/App_KernelDevDebugContainer.xml', '<container><services><service id="logger" class="Logger"/></services></container>');
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const certain = (): boolean => new ServiceIndex(dir, parsers).isCertain();

    it('is certain with a fresh dump and plain services YAML', () => {
      expect(certain()).toBe(true);
    });

    it('is not certain without dump, or with a dump older than the config', () => {
      fs.rmSync(path.join(dir, 'var'), { recursive: true });
      expect(certain()).toBe(false);
      write('var/cache/dev/App_KernelDevDebugContainer.xml', '<container/>');
      fs.utimesSync(path.join(dir, 'var', 'cache', 'dev', 'App_KernelDevDebugContainer.xml'), past, past);
      const bundles = write('config/bundles.php', '<?php return [];');
      expect(certain()).toBe(false);
      fs.utimesSync(bundles, past, past);
      fs.utimesSync(path.join(dir, 'config', 'packages', 'framework.yaml'), new Date(), new Date());
      expect(certain()).toBe(false);
    });

    it('is not certain with services.php, imports or invalid YAML', () => {
      fs.rmSync(path.join(dir, 'config', 'services.yaml'));
      write('config/services.php', '<?php');
      expect(certain()).toBe(false);
      write('config/services.yaml', "imports:\n    - { resource: 'services/' }\nservices: ~\n");
      expect(certain()).toBe(false);
      write('config/services.yaml', 'services:\n    when@dev:\n        imports: []\n');
      expect(certain()).toBe(true);
      write('config/services.yaml', 'when@dev:\n    imports: [x.yaml]\n');
      expect(certain()).toBe(false);
      write('config/services.yaml', 'services:\n    foo: [\n');
      expect(certain()).toBe(false);
      const index = new ServiceIndex(dir, parsers);
      index.updateYamlFile(path.join(dir, 'config', 'services.yaml'), 'services: ~\n');
      expect(index.isCertain()).toBe(true);
    });
  });
});
