import { describe, expect, it } from 'vitest';
import { findSecurityReferences, parseSecurityDeclarations, providerKey } from '../../src/security/securityYaml';

const names = (source: string, references: ReadonlyArray<{ nameStart: number; nameEnd: number }>): string[] =>
  references.map((reference) => source.slice(reference.nameStart, reference.nameEnd));

describe('parseSecurityDeclarations', () => {
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
    const { providers } = parseSecurityDeclarations(source, '/app/config/packages/security.yaml', 'dev')!;
    expect(providers.map((provider) => [provider.name, provider.type, provider.entityClass, provider.serviceId])).toEqual([
      ['users', 'entity', 'App\\Entity\\User', null],
      ['in_memory', 'memory', null, null],
      ['legacy', 'id', null, 'app.user_provider'],
      ['dev_users', 'chain', null, null],
    ]);
    expect(providers[0]!.location.range.start).toEqual({ line: 2, character: 8 });
  });

  it('returns null for invalid YAML and nothing without a security block', () => {
    expect(parseSecurityDeclarations('security: [\n', '/app/x.yaml', 'dev')).toBeNull();
    expect(parseSecurityDeclarations('framework:\n    providers: { a: { memory: ~ } }\n', '/app/x.yaml', 'dev')).toEqual({ providers: [], roleHierarchy: [], roles: [] });
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

describe('roles', () => {
  const source = [
    'security:',
    '    role_hierarchy:',
    '        ROLE_ADMIN: ROLE_USER',
    "        ROLE_SUPER_ADMIN: 'ROLE_ADMIN, ROLE_ALLOWED_TO_SWITCH'",
    '        ROLE_EDITOR: [ROLE_USER, ROLE_WRITER]',
    '    providers:',
    '        mem:',
    '            memory:',
    '                users:',
    '                    admin: { password: x, roles: [ROLE_OWNER] }',
    '                    bob: { password: x, roles: "ROLE_A,ROLE_B" }',
    '    firewalls:',
    '        main:',
    '            switch_user: { role: CAN_SWITCH }',
    '    access_control:',
    '        - { path: ^/admin, roles: ROLE_ADMIN }',
    '        - { path: ^/, roles: [PUBLIC_ACCESS, IS_AUTHENTICATED] }',
    '',
  ].join('\n');

  it('declares the hierarchy, strings split on commas', () => {
    const { roleHierarchy, roles } = parseSecurityDeclarations(source, '/app/config/packages/security.yaml', 'dev')!;
    expect(roleHierarchy.map((entry) => [entry.role, entry.includes])).toEqual([
      ['ROLE_ADMIN', ['ROLE_USER']],
      ['ROLE_SUPER_ADMIN', ['ROLE_ADMIN', 'ROLE_ALLOWED_TO_SWITCH']],
      ['ROLE_EDITOR', ['ROLE_USER', 'ROLE_WRITER']],
    ]);
    expect([...roles].sort()).toEqual(
      [
        'CAN_SWITCH',
        'IS_AUTHENTICATED',
        'PUBLIC_ACCESS',
        'ROLE_A',
        'ROLE_ADMIN',
        'ROLE_ALLOWED_TO_SWITCH',
        'ROLE_B',
        'ROLE_EDITOR',
        'ROLE_OWNER',
        'ROLE_SUPER_ADMIN',
        'ROLE_USER',
        'ROLE_WRITER',
      ].sort(),
    );
  });

  it('finds role references with their kind', () => {
    const references = findSecurityReferences(source, 'dev').roles;
    expect(references.map((reference) => [source.slice(reference.nameStart, reference.nameEnd), reference.declaration, reference.attributes])).toEqual([
      ['ROLE_ADMIN', true, false],
      ['ROLE_USER', false, false],
      ['ROLE_SUPER_ADMIN', true, false],
      ['ROLE_ADMIN', false, false],
      ['ROLE_ALLOWED_TO_SWITCH', false, false],
      ['ROLE_EDITOR', true, false],
      ['ROLE_USER', false, false],
      ['ROLE_WRITER', false, false],
      ['ROLE_OWNER', false, false],
      ['ROLE_A', false, false],
      ['ROLE_B', false, false],
      ['CAN_SWITCH', false, true],
      ['ROLE_ADMIN', false, true],
      ['PUBLIC_ACCESS', false, true],
      ['IS_AUTHENTICATED', false, true],
    ]);
  });
});

describe('findSecurityReferences: routes', () => {
  it('reads route names of the firewall options and of access_control', () => {
    const source = [
      'security:',
      '    firewalls:',
      '        main:',
      '            access_denied_url: app_denied',
      '            form_login: { login_path: app_login, check_path: "app_check", default_target_path: app_home, failure_path: app_failure }',
      '            json_login: { check_path: api_login }',
      '            login_link: { check_route: link_check }',
      '            switch_user: { target_route: app_home }',
      '            logout: { path: app_logout, target: app_bye }',
      '            remember_me: { path: not_a_route }',
      '    access_control:',
      '        - { route: admin_index, roles: ROLE_ADMIN }',
      '        - { path: ^/admin, roles: ROLE_ADMIN }',
      'when@dev:',
      '    security:',
      '        access_control:',
      '            - { route: dev_route }',
      '',
    ].join('\n');
    expect(names(source, findSecurityReferences(source, 'dev').routes)).toEqual([
      'app_denied',
      'app_login',
      'app_check',
      'app_home',
      'app_failure',
      'api_login',
      'link_check',
      'app_home',
      'app_logout',
      'app_bye',
      'admin_index',
      'dev_route',
    ]);
  });

  it('skips paths, absolute URLs and parameters where a path is allowed, not route-only options', () => {
    const source = [
      'security:',
      '    firewalls:',
      '        main:',
      '            form_login: { login_path: /login, check_path: "https://sso.example.com/check", default_target_path: "%app.home%" }',
      '            logout: { path: /logout, target: "//cdn" }',
      '            switch_user: { target_route: /not/a/path }',
      '',
    ].join('\n');
    // `//cdn` starts with `/`: HttpUtils reads it as a path.
    expect(names(source, findSecurityReferences(source, 'dev').routes)).toEqual(['/not/a/path']);
  });
});

describe('providerKey', () => {
  it('reads dashes as underscores and ignores case', () => {
    expect(providerKey('Memory-Users')).toBe(providerKey('memory_users'));
  });
});
