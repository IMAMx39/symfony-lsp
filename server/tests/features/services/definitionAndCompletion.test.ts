import * as path from 'node:path';
import { TextEdit } from 'vscode-languageserver';
import { beforeAll, describe, expect, it } from 'vitest';
import { provideServiceCompletion } from '../../../src/features/services/completion';
import { provideServiceDefinition } from '../../../src/features/services/definition';
import { ServiceIndex } from '../../../src/index/ServiceIndex';
import { findServiceReferences } from '../../../src/services/yamlServices';
import { isSamePath, pathToUri, uriToPath } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const servicesUri = pathToUri(path.join(fixtureApp, 'config', 'services.yaml'));

describe('services in YAML', () => {
  let index: ServiceIndex;

  beforeAll(async () => {
    index = new ServiceIndex(fixtureApp, await loadParsers());
  });

  const at = (source: string) => {
    const { document, offset } = withCursor(servicesUri, 'yaml', source);
    return { document, position: document.positionAt(offset), references: findServiceReferences(document.getText(), 'dev') };
  };

  describe('definition', () => {
    const definition = (source: string) => {
      const { document, position, references } = at(source);
      return provideServiceDefinition(document, position, references, index);
    };

    it('goes to the YAML declaration of the service', () => {
      const location = definition("services:\n    foo:\n        arguments: ['@app.news|letter']\n");
      expect(isSamePath(uriToPath(location!.uri), path.join(fixtureApp, 'config', 'services.yaml'))).toBe(true);
    });

    it('goes to the class of a container-only service, on the quotes and prefix too', () => {
      for (const source of ["arguments: [|'@?compiled.only']", "arguments: ['@?|compiled.only']"]) {
        const location = definition(`services:\n    foo:\n        ${source}\n`);
        expect(isSamePath(uriToPath(location!.uri), path.join(fixtureApp, 'src', 'Service', 'Newsletter.php'))).toBe(true);
      }
    });

    it('returns nothing for unknown ids and non-reference positions', () => {
      expect(definition("services:\n    foo:\n        arguments: ['@unknown|']\n")).toBeNull();
      expect(definition("services:\n    foo:\n        arguments: ['@@app.mail|er']\n")).toBeNull();
      expect(definition("services:\n    foo:\n        tags: [{ name: t, ref: '@app.mail|er' }]\n")).toBeNull();
      expect(definition("services:\n    fo|o:\n        arguments: ['@app.mailer']\n")).toBeNull();
    });
  });

  describe('completion', () => {
    const complete = (source: string) => {
      const { document, position, references } = at(source);
      return provideServiceCompletion(document, position, references, index.visibleServices());
    };

    it('proposes every visible id and replaces the whole id', () => {
      const items = complete("services:\n    foo:\n        arguments: ['@?app.ma|xyz']\n")!;
      expect(items.map((item) => item.label)).toContain('app.debug_mailer');
      expect(items.map((item) => item.label)).not.toContain('.service_locator.Xyz123');
      const mailer = items.find((item) => item.label === 'app.newsletter')!;
      expect(mailer.detail).toBe('App\\Service\\Newsletter');
      expect((mailer.textEdit as TextEdit).range).toEqual({ start: { line: 2, character: 23 }, end: { line: 2, character: 32 } });
      expect(items.find((item) => item.label === 'app.mailer')?.detail).toBe('alias of App\\Service\\Mailer');
    });

    it('works right after @, in double quotes and in block sequences', () => {
      expect(complete("services:\n    foo:\n        arguments: ['@|']\n")).not.toBeNull();
      expect(complete('services:\n    foo:\n        arguments: ["@|"]\n')).not.toBeNull();
      expect(complete("services:\r\n    foo:\r\n        calls:\r\n            - setBar: ['@|']\r\n")).not.toBeNull();
    });

    it('stays silent before the @ and outside references', () => {
      expect(complete("services:\n    foo:\n        arguments: ['|@']\n")).toBeNull();
      expect(complete("services:\n    foo:\n        arguments: ['%param|%']\n")).toBeNull();
      expect(complete("parameters:\n    p: '@|'\n")).toBeNull();
      expect(complete("services:\n    foo:\n        arguments: ['@=service(|)']\n")).toBeNull();
    });
  });
});
