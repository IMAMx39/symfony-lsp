import { describe, expect, it } from 'vitest';
import { findSecurityReferences, parseSecurityProviders, providerKey } from '../../src/security/securityYaml';

const names = (source: string, references: ReadonlyArray<{ nameStart: number; nameEnd: number }>): string[] =>
  references.map((reference) => source.slice(reference.nameStart, reference.nameEnd));

describe('parseSecurityProviders', () => {
  it('reads providers of the root block and of when@dev, with their type', () => {
    const source = [
      'security:',
      '    providers:',
      '        users:',
      '            entity: { class: \\App\\Entity\\User, property: email }',
      '        in_memory: { memory: ~ }',
      '        legacy: { id: app.user_provider }',
      'when@dev:',
      '    security:',
      '        providers:',
      '            dev_users: { chain: { providers: [users] } }',
      'when@prod:',
      '    security:',
      '        providers:',
      '            prod_users: { memory: ~ }',
      '',
    ].join('\n');
    const providers = parseSecurityProviders(source, '/app/config/packages/security.yaml', 'dev')!;
    expect(providers.map((provider) => [provider.name, provider.type, provider.entityClass, provider.serviceId])).toEqual([
      ['users', 'entity', 'App\\Entity\\User', null],
      ['in_memory', 'memory', null, null],
      ['legacy', 'id', null, 'app.user_provider'],
      ['dev_users', 'chain', null, null],
    ]);
    expect(providers[0]!.location.range.start).toEqual({ line: 2, character: 8 });
  });

  it('returns null for invalid YAML and nothing without a security block', () => {
    expect(parseSecurityProviders('security: [\n', '/app/x.yaml', 'dev')).toBeNull();
    expect(parseSecurityProviders('framework:\n    providers: { a: { memory: ~ } }\n', '/app/x.yaml', 'dev')).toEqual([]);
  });
});

describe('findSecurityReferences', () => {
  it('finds provider names of firewalls, authenticators, switch_user and chains', () => {
    const source = [
      'security:',
      '    providers:',
      '        all: { chain: { providers: [users, "legacy"] } }',
      '        csv: { chain: { providers: "a, b ,c" } }',
      '    firewalls:',
      '        main:',
      '            provider: users',
      '            form_login: { provider: legacy, login_path: login }',
      '            switch_user: { provider: all }',
      '            http_basic: ~',
      '',
    ].join('\n');
    expect(names(source, findSecurityReferences(source, 'dev').providers)).toEqual(['users', 'legacy', 'a', 'b', 'c', 'users', 'legacy', 'all']);
  });

  it('keeps an empty value, for completion', () => {
    const source = 'security:\n    firewalls:\n        main:\n            provider: \n';
    const [reference] = findSecurityReferences(source, 'dev').providers;
    expect(reference).toMatchObject({ name: '', nameStart: source.indexOf('provider: ') + 10 });
  });

  it('finds service ids, with class references for namespaced ones', () => {
    const source = [
      'security:',
      '    providers:',
      '        legacy: { id: app.user_provider }',
      '    firewalls:',
      '        main:',
      '            user_checker: App\\Security\\UserChecker',
      '            access_denied_handler: app.denied',
      '            entry_point: app.entry',
      '            custom_authenticators: [App\\Security\\Authenticator]',
      '            form_login: { success_handler: app.success, failure_handler: app.failure }',
      '        api:',
      '            entry_point: form_login',
      '            form_login: ~',
      '',
    ].join('\n');
    const { services, classes } = findSecurityReferences(source, 'dev');
    expect(services.map((service) => [service.id, service.optional])).toEqual([
      ['app.user_provider', false],
      ['App\\Security\\UserChecker', false],
      ['app.denied', false],
      ['app.entry', true],
      ['App\\Security\\Authenticator', false],
      ['app.success', false],
      ['app.failure', false],
    ]);
    expect(classes.map((reference) => reference.className)).toEqual(['App\\Security\\UserChecker', 'App\\Security\\Authenticator']);
  });

  it('finds the entity class and property of entity providers', () => {
    const source = "security:\n    providers:\n        users:\n            entity: { class: 'App\\Entity\\User', property: email }\n";
    const { classes, entityProperties } = findSecurityReferences(source, 'dev');
    expect(classes.map((reference) => reference.className)).toEqual(['App\\Entity\\User']);
    expect(entityProperties).toMatchObject([{ name: 'email', entityClass: 'App\\Entity\\User' }]);
  });

  it('ignores other environments, other extensions and values that are not plain text', () => {
    const source = [
      'framework:',
      '    firewalls: { main: { provider: nope } }',
      'when@prod:',
      '    security:',
      '        firewalls: { main: { provider: prod } }',
      'security:',
      '    firewalls:',
      '        main:',
      '            provider: "esc\\u0061ped"',
      '            user_checker: |',
      '                app.block',
      '',
    ].join('\n');
    const references = findSecurityReferences(source, 'dev');
    expect(references.providers).toEqual([]);
    expect(references.services).toEqual([]);
  });
});

describe('providerKey', () => {
  it('reads dashes as underscores and ignores case', () => {
    expect(providerKey('Memory-Users')).toBe(providerKey('memory_users'));
  });
});
