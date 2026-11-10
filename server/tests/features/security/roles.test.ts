import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { provideRoleCompletion } from '../../../src/features/security/completion';
import { provideRoleDefinition } from '../../../src/features/security/definition';
import { provideRoleHover } from '../../../src/features/security/hover';
import { SecurityConfig } from '../../../src/project/SecurityConfig';
import { findSecurityReferences } from '../../../src/security/securityYaml';
import { pathToUri } from '../../../src/util/paths';
import { fixtureApp, withCursor } from '../../helpers';

const securityUri = pathToUri(path.join(fixtureApp, 'config', 'packages', 'security.yaml'));
const accessControl = (rule: string): string => `security:\n    access_control:\n        - ${rule}\n`;
const hierarchy = (entry: string): string => `security:\n    role_hierarchy:\n        ${entry}\n`;

describe('roles in security.yaml', () => {
  let config: SecurityConfig;

  beforeAll(() => {
    config = new SecurityConfig(fixtureApp);
  });

  const at = (source: string) => {
    const { document, offset } = withCursor(securityUri, 'yaml', source);
    return { document, position: document.positionAt(offset), references: findSecurityReferences(document.getText(), 'dev').roles };
  };

  describe('completion', () => {
    const labels = (source: string): string[] | undefined => {
      const { document, position, references } = at(source);
      return provideRoleCompletion(document, position, references, config)?.map((item) => item.label);
    };

    it('proposes the roles of the configuration and the voter attributes in access_control', () => {
      const items = labels(accessControl('{ path: ^/, roles: ROLE_| }'))!;
      expect(items).toEqual(expect.arrayContaining(['ROLE_ADMIN', 'ROLE_USER', 'ROLE_SUPER_ADMIN', 'ROLE_ALLOWED_TO_SWITCH', 'PUBLIC_ACCESS', 'IS_AUTHENTICATED_FULLY']));
      expect(items.filter((label) => label === 'IS_AUTHENTICATED_FULLY')).toHaveLength(1);
    });

    it('proposes roles only in role_hierarchy values, nothing on its keys', () => {
      const items = labels(hierarchy('ROLE_X: [ROLE_USER, ROLE_|]'))!;
      expect(items).toContain('ROLE_ADMIN');
      expect(items).not.toContain('PUBLIC_ACCESS');
      expect(labels(hierarchy('ROLE_|X: ROLE_USER'))).toBeUndefined();
    });

    it('describes what a role includes and replaces the whole name', () => {
      const { document, position, references } = at(accessControl('{ path: ^/, roles: "ROLE_SU|PER" }'));
      const item = provideRoleCompletion(document, position, references, config)!.find((candidate) => candidate.label === 'ROLE_SUPER_ADMIN')!;
      expect(item.detail).toBe('includes ROLE_ADMIN, ROLE_ALLOWED_TO_SWITCH, ROLE_USER');
      const edit = item.textEdit as { range: { start: { character: number }; end: { character: number } } };
      const line = document.getText().split('\n')[2]!;
      expect(line.slice(edit.range.start.character, edit.range.end.character)).toBe('ROLE_SUPER');
    });
  });

  describe('definition', () => {
    it('goes to the role_hierarchy key of a role', () => {
      const { document, position, references } = at(accessControl('{ path: ^/, roles: [ROLE_AD|MIN] }'));
      const location = provideRoleDefinition(document, position, references, config);
      expect(location?.range.start).toEqual({ line: 2, character: 8 });
    });

    it('returns nothing for a role outside the hierarchy or on a key', () => {
      const outside = at(accessControl('{ path: ^/, roles: ROLE_US|ER }'));
      expect(provideRoleDefinition(outside.document, outside.position, outside.references, config)).toBeNull();
      const key = at(hierarchy('ROLE_AD|MIN: ROLE_USER'));
      expect(provideRoleDefinition(key.document, key.position, key.references, config)).toBeNull();
    });
  });

  describe('hover', () => {
    const hover = (source: string): string | null => {
      const { document, position, references } = at(source);
      const result = provideRoleHover(document, position, references, config, fixtureApp);
      return result === null ? null : (result.contents as { value: string }).value;
    };

    it('shows the reachable roles, the including roles and the declaration', () => {
      const text = hover(accessControl('{ path: ^/, roles: ROLE_AD|MIN }'))!;
      expect(text).toContain('Includes: `ROLE_USER`');
      expect(text).toContain('Included in: `ROLE_SUPER_ADMIN`');
      expect(text).toContain('config/packages/security.yaml:3');
    });

    it('explains voter attributes and says nothing about an isolated role', () => {
      expect(hover(accessControl('{ path: ^/, roles: PUBLIC_AC|CESS }'))).toContain('AuthenticatedVoter');
      expect(hover(accessControl('{ path: ^/, roles: ROLE_NOB|ODY }'))).toBeNull();
    });
  });

  describe('hierarchy of several files', () => {
    let dir: string | null = null;

    afterEach(() => {
      if (dir !== null) {
        fs.rmSync(dir, { recursive: true, force: true });
        dir = null;
      }
    });

    it('lets a later declaration of a role replace the earlier one, and survives cycles', () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symfony-zed-roles-'));
      const write = (relative: string, content: string): void => {
        const file = path.join(dir!, ...relative.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
      };
      write('config/packages/security.yaml', 'security:\n    role_hierarchy:\n        ROLE_A: [ROLE_B]\n        ROLE_B: [ROLE_A, ROLE_C]\n');
      write('config/packages/dev/security.yaml', 'security:\n    role_hierarchy:\n        ROLE_A: [ROLE_B, ROLE_D]\n');
      const local = new SecurityConfig(dir);
      expect(local.roleHierarchy().get('ROLE_A')?.includes).toEqual(['ROLE_B', 'ROLE_D']);
      expect(local.reachableRoles('ROLE_A')).toEqual(['ROLE_B', 'ROLE_D', 'ROLE_C']);
      expect(local.rolesIncluding('ROLE_C')).toEqual(['ROLE_A', 'ROLE_B']);
    });
  });
});
