import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SecurityConfig } from '../../src/project/SecurityConfig';
import { fixtureApp } from '../helpers';

describe('SecurityConfig', () => {
  it('reads the providers of the fixture, when@dev included', () => {
    const config = new SecurityConfig(fixtureApp);
    expect(config.providers().map((provider) => provider.name)).toEqual(['app_user_provider', 'memory-users', 'all_users', 'dev_users']);
    expect(config.findProvider('MEMORY_users')?.name).toBe('memory-users');
    expect(config.findProvider('prod_users')).toBeUndefined();
    expect(config.isCertain()).toBe(true);
  });

  it('knows which files it reads', () => {
    const file = (relative: string): string => path.join(fixtureApp, ...relative.split('/'));
    expect(SecurityConfig.isConfigFile(file('config/packages/security.yaml'), fixtureApp)).toBe(true);
    expect(SecurityConfig.isConfigFile(file('config/packages/dev/security.yml'), fixtureApp)).toBe(true);
    expect(SecurityConfig.isConfigFile(file('config/services.yaml'), fixtureApp)).toBe(true);
    expect(SecurityConfig.isConfigFile(file('config/packages/prod/security.yaml'), fixtureApp)).toBe(false);
    expect(SecurityConfig.isConfigFile(file('config/routes.yaml'), fixtureApp)).toBe(false);
  });

  describe('in a temporary project', () => {
    let dir: string;
    const write = (relative: string, content: string): string => {
      const file = path.join(dir, ...relative.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      return file;
    };

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symfony-zed-security-'));
      write('config/packages/security.yaml', 'security:\n    providers:\n        users: { memory: ~ }\n');
      write('config/services.yaml', 'services: ~\n');
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('merges files in loading order and lets an open document override its file', () => {
      const devFile = write('config/packages/dev/security.yaml', 'security:\n    providers:\n        dev: { memory: ~ }\n');
      const config = new SecurityConfig(dir);
      expect(config.providers().map((provider) => provider.name)).toEqual(['users', 'dev']);
      expect(config.updateFile(devFile, 'security:\n    providers:\n        edited: { memory: ~ }\n')).toBe(true);
      expect(config.providers().map((provider) => provider.name)).toEqual(['users', 'edited']);
      expect(config.updateFile(path.join(dir, 'config', 'routes.yaml'), 'x: 1\n')).toBe(false);
    });

    it('keeps the previous providers of an invalid document, but is no longer certain', () => {
      const config = new SecurityConfig(dir);
      config.updateFile(path.join(dir, 'config', 'packages', 'security.yaml'), 'security: [\n');
      expect(config.providers().map((provider) => provider.name)).toEqual(['users']);
      expect(config.isCertain()).toBe(false);
    });

    it('is not certain with PHP configuration or imports', () => {
      expect(new SecurityConfig(dir).isCertain()).toBe(true);
      const php = write('config/packages/dev/security.php', '<?php');
      expect(new SecurityConfig(dir).isCertain()).toBe(false);
      fs.rmSync(php);
      write('config/services.yaml', "imports:\n    - { resource: 'security/' }\n");
      expect(new SecurityConfig(dir).isCertain()).toBe(false);
      fs.rmSync(path.join(dir, 'config', 'services.yaml'));
      write('config/services.php', '<?php');
      expect(new SecurityConfig(dir).isCertain()).toBe(false);
    });
  });
});
