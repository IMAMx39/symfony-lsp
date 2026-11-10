import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Diagnostic } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { beforeAll, describe, expect, it } from 'vitest';
import { DoctrineEntities } from '../../../src/doctrine/DoctrineEntities';
import { provideServiceCompletion } from '../../../src/features/services/completion';
import { provideEntityPropertyCompletion, provideSecurityProviderCompletion } from '../../../src/features/security/completion';
import { provideSecurityDefinition } from '../../../src/features/security/definition';
import { PROVIDER_NOT_FOUND, provideSecurityDiagnostics } from '../../../src/features/security/diagnostics';
import { SERVICE_NOT_FOUND } from '../../../src/features/services/diagnostics';
import { ServiceIndex } from '../../../src/index/ServiceIndex';
import { SecurityConfig } from '../../../src/project/SecurityConfig';
import { findSecurityReferences } from '../../../src/security/securityYaml';
import { isSamePath, pathToUri, uriToPath } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const securityFile = path.join(fixtureApp, 'config', 'packages', 'security.yaml');
const securityUri = pathToUri(securityFile);
const firewall = (options: string): string => `security:\n    firewalls:\n        main:\n${options}`;

describe('security providers and services', () => {
  let config: SecurityConfig;
  let services: ServiceIndex;
  let doctrine: DoctrineEntities;

  beforeAll(async () => {
    const parsers = await loadParsers();
    const now = new Date();
    fs.utimesSync(path.join(fixtureApp, 'var', 'cache', 'dev', 'App_KernelDevDebugContainer.xml'), now, now);
    config = new SecurityConfig(fixtureApp);
    services = new ServiceIndex(fixtureApp, parsers);
    doctrine = new DoctrineEntities(fixtureApp, parsers);
  });

  const at = (source: string) => {
    const { document, offset } = withCursor(securityUri, 'yaml', source);
    return { document, position: document.positionAt(offset), references: findSecurityReferences(document.getText(), 'dev') };
  };

  describe('definition', () => {
    const definition = (source: string) => {
      const { document, position, references } = at(source);
      return provideSecurityDefinition(document, position, references, config, services, doctrine, () => null);
    };
    const lineOf = (source: string, file: string): number => fs.readFileSync(file, 'utf8').split(/\r?\n/).findIndex((line) => line.includes(source));

    it('goes to the declared provider, names compared like SecurityExtension', () => {
      for (const source of ['            provider: all_us|ers\n', '            form_login: { provider: "memory_us|ers" }\n']) {
        const location = definition(firewall(source));
        expect(isSamePath(uriToPath(location!.uri), securityFile)).toBe(true);
      }
      const location = definition(firewall('            provider: all_us|ers\n'));
      expect(location!.range.start.line).toBe(lineOf('all_users:', securityFile));
    });

    it('goes to the provider declared in when@dev, not in another environment', () => {
      expect(definition(firewall('            provider: dev_us|ers\n'))).not.toBeNull();
      expect(definition(firewall('            provider: prod_us|ers\n'))).toBeNull();
    });

    it('goes to the mapped field of an entity provider', () => {
      const location = definition('security:\n    providers:\n        u:\n            entity: { class: App\\Entity\\User, property: em|ail }\n');
      const userFile = path.join(fixtureApp, 'src', 'Entity', 'User.php');
      expect(isSamePath(uriToPath(location!.uri), userFile)).toBe(true);
      expect(location!.range.start.line).toBe(lineOf('$email', userFile));
    });

    it('goes to the entity class, and to the class of a service id', () => {
      const entity = definition('security:\n    providers:\n        u:\n            entity: { class: App\\Entity\\Us|er }\n');
      expect(isSamePath(uriToPath(entity!.uri), path.join(fixtureApp, 'src', 'Entity', 'User.php'))).toBe(true);
      const checker = definition(firewall('            user_checker: App\\Security\\User|Checker\n'));
      expect(isSamePath(uriToPath(checker!.uri), path.join(fixtureApp, 'src', 'Security', 'UserChecker.php'))).toBe(true);
    });

    it('goes to a service declared in YAML', () => {
      const location = definition(firewall('            access_denied_handler: app.news|letter\n'));
      expect(isSamePath(uriToPath(location!.uri), path.join(fixtureApp, 'config', 'services.yaml'))).toBe(true);
    });

    it('returns nothing outside references', () => {
      expect(definition(firewall('            pat|tern: ^/\n'))).toBeNull();
      expect(definition(firewall('            provider: unknown|\n'))).toBeNull();
    });
  });

  describe('completion', () => {
    it('proposes every provider once and replaces the whole name', () => {
      const { document, position, references } = at(firewall('            provider: app_|xyz\n'));
      const items = provideSecurityProviderCompletion(document, position, references, config.providers())!;
      expect(items.map((item) => item.label)).toEqual(['app_user_provider', 'memory-users', 'all_users', 'dev_users']);
      expect(items[0]).toMatchObject({ detail: 'entity: App\\Entity\\User' });
      const edit = items[0]!.textEdit as { range: { start: { character: number }; end: { character: number } } };
      expect([edit.range.start.character, edit.range.end.character]).toEqual([22, 29]);
    });

    it('completes an empty value and chain items', () => {
      const empty = at(firewall('            provider: |\n'));
      expect(provideSecurityProviderCompletion(empty.document, empty.position, empty.references, config.providers())).toHaveLength(4);
      const chain = at('security:\n    providers:\n        c: { chain: { providers: [app_user_provider, al|] } }\n');
      expect(provideSecurityProviderCompletion(chain.document, chain.position, chain.references, config.providers())).not.toBeNull();
    });

    it('proposes the columns of the entity, not its associations', () => {
      const { document, position, references } = at('security:\n    providers:\n        u:\n            entity: { class: App\\Entity\\User, property: | }\n');
      const items = provideEntityPropertyCompletion(document, position, references, doctrine, () => null)!;
      expect(items.map((item) => item.label)).toEqual(['id', 'email', 'roles']);
    });

    it('proposes nothing for the property of an unmapped class', () => {
      const { document, position, references } = at('security:\n    providers:\n        u:\n            entity: { class: App\\Service\\Mailer, property: | }\n');
      expect(provideEntityPropertyCompletion(document, position, references, doctrine, () => null)).toBeNull();
    });

    it('proposes service ids for service options', () => {
      const { document, position, references } = at(firewall('            user_checker: app.|\n'));
      const items = provideServiceCompletion(document, position, references.services, services.visibleServices())!;
      expect(items.map((item) => item.label)).toContain('app.mailer');
    });
  });

  describe('diagnostics', () => {
    const diagnose = (source: string, securityConfig = config): Diagnostic[] => {
      const document = TextDocument.create(securityUri, 'yaml', 1, source);
      return provideSecurityDiagnostics(document, findSecurityReferences(source, 'dev'), securityConfig, services);
    };

    it('reports unknown providers and services', () => {
      const diagnostics = diagnose(firewall('            provider: nope\n            form_login: { provider: Memory-Users }\n            user_checker: app.unknown\n'));
      expect(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.message])).toEqual([
        [PROVIDER_NOT_FOUND, 'User provider "nope" not found.'],
        [SERVICE_NOT_FOUND, 'Service "app.unknown" not found.'],
      ]);
      expect(diagnostics[0]!.range.start).toEqual({ line: 3, character: 22 });
    });

    it('reports nothing for an empty value, an entry point or a class that may be autoregistered', () => {
      expect(diagnose(firewall('            provider: \n            entry_point: app.unknown\n            user_checker: App\\Security\\UserChecker\n'))).toEqual([]);
    });

    it('reports no provider when the configuration is not certain', () => {
      const uncertain = new SecurityConfig(fixtureApp);
      uncertain.updateFile(securityFile, 'security: [\n');
      expect(diagnose(firewall('            provider: nope\n'), uncertain)).toEqual([]);
    });
  });
});
