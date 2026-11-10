import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { provideRoleCompletion } from '../../../src/features/security/completion';
import { provideRoleDefinition } from '../../../src/features/security/definition';
import { provideRoleHover } from '../../../src/features/security/hover';
import { RoleReferenceFinder } from '../../../src/features/security/RoleReferenceFinder';
import type { DocumentLanguage, Parsers } from '../../../src/parsing/parsers';
import { SecurityConfig } from '../../../src/project/SecurityConfig';
import { isSamePath, pathToUri, uriToPath } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const USE_IS_GRANTED = 'use Symfony\\Component\\Security\\Http\\Attribute\\IsGranted;';

describe('roles in PHP and Twig', () => {
  let parsers: Parsers;
  let finder: RoleReferenceFinder;
  let config: SecurityConfig;

  beforeAll(async () => {
    parsers = await loadParsers();
    finder = new RoleReferenceFinder(parsers);
    config = new SecurityConfig(fixtureApp);
  });

  const roles = (language: DocumentLanguage, source: string): string[] => {
    const tree = parsers.parse(language, source)!;
    const references = finder.find(language, tree.rootNode);
    tree.delete();
    return references.map((reference) => source.slice(reference.nameStart, reference.nameEnd));
  };

  const at = (language: DocumentLanguage, source: string, marker = '|') => {
    const file = path.join(fixtureApp, language === 'php' ? 'src/Controller/TestController.php' : 'templates/test.html.twig');
    const { document, offset } = withCursor(pathToUri(file), language, source, marker);
    const tree = parsers.parse(language, document.getText())!;
    const references = finder.find(language, tree.rootNode);
    tree.delete();
    return { document, position: document.positionAt(offset), references };
  };

  describe('references', () => {
    it('reads the attribute argument of isGranted() checks, positional or named', () => {
      const source = [
        '<?php',
        "$this->isGranted('ROLE_A');",
        "$this->denyAccessUnlessGranted('ROLE_B', $post);",
        "$security->isGranted(attributes: 'ROLE_C');",
        "$checker->isGranted(subject: $post, attribute: 'ROLE_D');",
        "$security->isGrantedForUser($user, 'ROLE_E');",
        "$security->isGrantedForUser(user: $user, attribute: 'ROLE_F');",
      ].join('\n');
      expect(roles('php', source)).toEqual(['ROLE_A', 'ROLE_B', 'ROLE_C', 'ROLE_D', 'ROLE_E', 'ROLE_F']);
    });

    it('reads #[IsGranted] only when its name resolves to the Security attribute', () => {
      const source = [
        '<?php',
        USE_IS_GRANTED,
        "#[IsGranted('ROLE_ADMIN')]",
        'class A {',
        "    #[IsGranted(attribute: 'ROLE_EDITOR', subject: 'post')]",
        '    public function edit() {}',
        "    #[\\Symfony\\Component\\Security\\Http\\Attribute\\IsGranted('ROLE_FQCN')]",
        '    public function fqcn() {}',
        "    #[Other('ROLE_NOPE')]",
        '    public function other() {}',
        '}',
      ].join('\n');
      expect(roles('php', source)).toEqual(['ROLE_ADMIN', 'ROLE_EDITOR', 'ROLE_FQCN']);
      expect(roles('php', "<?php\n#[IsGranted('ROLE_UNIMPORTED')]\nclass B {}\n")).toEqual([]);
    });

    it('reads is_granted() and is_granted_for_user() in Twig', () => {
      expect(roles('twig', "{% if is_granted('ROLE_A') %}{{ is_granted_for_user(user, \"ROLE_B\") }}{% endif %}")).toEqual(['ROLE_A', 'ROLE_B']);
    });

    it('ignores non-literal values, other arguments and argument unpacking', () => {
      const source = [
        '<?php',
        '$this->isGranted($role);',
        "$this->isGranted('ROLE_' . $name);",
        "$this->isGranted(\"ROLE_{$name}\");",
        "$this->isGranted(...$args, 'ROLE_X');",
        "$this->isGranted(new Expression('is_granted(\"ROLE_Y\")'));",
        "$security->isGrantedForUser('ROLE_NOT_THE_ATTRIBUTE');",
        "$this->hasRole('ROLE_Z');",
      ].join('\n');
      expect(roles('php', source)).toEqual([]);
      expect(roles('twig', '{{ is_granted(role) }}{{ is_granted_for_user("ROLE_USER_ARG") }}')).toEqual([]);
    });
  });

  it('completes roles and voter attributes, replacing the literal content', () => {
    const { document, position, references } = at('php', "<?php\n$this->denyAccessUnlessGranted('ROLE_|XX');");
    const items = provideRoleCompletion(document, position, references, config)!;
    expect(items.map((item) => item.label)).toEqual(expect.arrayContaining(['ROLE_ADMIN', 'ROLE_SUPER_ADMIN', 'IS_AUTHENTICATED_FULLY']));
    const edit = items[0]!.textEdit as { range: { start: { character: number }; end: { character: number } } };
    expect([edit.range.start.character, edit.range.end.character]).toEqual([32, 39]);
  });

  it('goes to the role_hierarchy key and shows the hierarchy on hover', () => {
    const { document, position, references } = at('twig', "{% if is_granted('ROLE_AD‸MIN') %}{% endif %}", '‸');
    const location = provideRoleDefinition(document, position, references, config);
    expect(isSamePath(uriToPath(location!.uri), path.join(fixtureApp, 'config', 'packages', 'security.yaml'))).toBe(true);
    const hover = provideRoleHover(document, position, references, config, fixtureApp);
    expect((hover!.contents as { value: string }).value).toContain('Includes: `ROLE_USER`');
  });
});
