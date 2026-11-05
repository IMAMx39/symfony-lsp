import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { provideClassDefinition } from '../../../src/features/services/definition';
import { ServiceIndex } from '../../../src/index/ServiceIndex';
import { findClassReferences } from '../../../src/services/yamlServices';
import { isSamePath, pathToUri, uriToPath } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const servicesFile = path.join(fixtureApp, 'config', 'services.yaml');

describe('class names in services YAML', () => {
  let index: ServiceIndex;

  beforeAll(async () => {
    index = new ServiceIndex(fixtureApp, await loadParsers());
  });

  describe('findClassReferences', () => {
    const names = (source: string): string[] => findClassReferences(source, 'dev').map((reference) => reference.className);

    it('finds class service keys, class: values and _instanceof keys of the fixture', () => {
      expect(names(fs.readFileSync(servicesFile, 'utf8'))).toEqual([
        'App\\Service\\MailerAware',
        'App\\Service\\Mailer',
        'App\\Service\\Newsletter',
        'App\\Service\\Mailer',
      ]);
    });

    it('skips ids, prototypes, _defaults, other environments and non-class values', () => {
      const source = [
        'services:',
        '    _defaults: { autowire: true }',
        "    App\\: { resource: '../src/' }",
        '    app.mailer: { alias: App\\Mailer }',
        "    app.x: { class: '%app.class%' }",
        '    plain: ~',
        "    '\\App\\Quoted\\Key': ~",
        'when@prod:',
        '    services:',
        '        App\\Prod\\Only: ~',
      ].join('\n');
      expect(names(source)).toEqual(['App\\Quoted\\Key']);
    });

    it('covers the scalar, quotes included', () => {
      const source = "services:\n    app.x:\n        class: 'App\\X'\n";
      const [reference] = findClassReferences(source, 'dev');
      expect(source.slice(reference!.start, reference!.end)).toBe("'App\\X'");
    });
  });

  describe('definition', () => {
    const definition = (source: string) => {
      const { document, offset } = withCursor(pathToUri(servicesFile), 'yaml', source);
      return provideClassDefinition(document, document.positionAt(offset), findClassReferences(document.getText(), 'dev'), index);
    };
    const expectFile = (location: ReturnType<typeof definition>, ...segments: string[]): void => {
      expect(location).not.toBeNull();
      expect(isSamePath(uriToPath(location!.uri), path.join(fixtureApp, ...segments))).toBe(true);
    };

    it('goes to the class of a service key, in src/ or vendor/', () => {
      expectFile(definition('services:\n    App\\Service\\Mai|ler:\n        arguments: []\n'), 'src', 'Service', 'Mailer.php');
      expectFile(definition('services:\n    Acme\\FooBundle\\Mailer\\Trans|port: ~\n'), 'vendor', 'acme', 'foo-bundle', 'src', 'Mailer', 'Transport.php');
    });

    it('goes to the class of a class: value and to an _instanceof interface', () => {
      expectFile(definition('services:\n    app.x:\n        class: App\\Service\\News|letter\n'), 'src', 'Service', 'Newsletter.php');
      const location = definition('services:\n    _instanceof:\n        App\\Service\\Mailer|Aware:\n            tags: [x]\n');
      expectFile(location, 'src', 'Service', 'MailerAware.php');
      expect(location!.range.start).toEqual({ line: 4, character: 10 });
    });

    it('returns nothing for unknown classes and service ids', () => {
      expect(definition('services:\n    App\\Service\\Unkno|wn: ~\n')).toBeNull();
      expect(definition('services:\n    app.mai|ler: ~\n')).toBeNull();
    });
  });
});
