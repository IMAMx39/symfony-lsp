import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DoctrineEntities } from '../../../src/doctrine/DoctrineEntities';
import { provideRepositoryDefinition } from '../../../src/features/doctrine/definition';
import { RepositoryReferenceFinder } from '../../../src/features/doctrine/RepositoryReferenceFinder';
import type { Parsers } from '../../../src/parsing/parsers';
import { isSamePath, pathToUri, uriToPath } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const PRELUDE = '<?php\nnamespace App\\Controller;\nuse App\\Entity\\Product;\nuse App\\Entity as E;\n';

describe('repository definition', () => {
  let parsers: Parsers;
  let finder: RepositoryReferenceFinder;
  let resolver: DoctrineEntities;

  beforeAll(async () => {
    parsers = await loadParsers();
    finder = new RepositoryReferenceFinder(parsers);
    resolver = new DoctrineEntities(fixtureApp, parsers);
  });

  function definition(code: string, openText?: (file: string) => string | null): { file: string; line: number } | null {
    const { document, offset } = withCursor(pathToUri(path.join(fixtureApp, 'src/Controller/TestController.php')), 'php', PRELUDE + code);
    const tree = parsers.parse('php', document.getText())!;
    const references = finder.find(tree.rootNode);
    tree.delete();
    const location = provideRepositoryDefinition(document, document.positionAt(offset), references, resolver, openText);
    return location && { file: uriToPath(location.uri), line: location.range.start.line };
  }

  const productRepository = path.join(fixtureApp, 'src', 'Repository', 'ProductRepository.php');
  const categoryRepository = path.join(fixtureApp, 'src', 'Repository', 'CategoryRepository.php');

  it.each([
    ['an imported class', `$em->getRepository(Prod|uct::class);`],
    ['an aliased namespace', `$this->registry->getRepository(E\\Product::cl|ass);`],
    ['a fully qualified class', `$em->getRepository(\\App\\Entity\\Pro|duct::class);`],
    ['a string', `$em->getRepository('App\\Entity\\Pro|duct');`],
    ['a named argument', `$em->getRepository(className: Pro|duct::class);`],
    ['a ManagerRegistry named argument', `$registry->getRepository(persistentObject: Pro|duct::class, persistentManagerName: 'default');`],
  ])('goes to the repositoryClass of the entity from %s', (_label, code) => {
    const target = definition(code);
    expect(target && isSamePath(target.file, productRepository)).toBe(true);
    expect(target?.line).toBe(9);
  });

  it('reads a positional string repositoryClass and an attribute imported by its own name', () => {
    const target = definition(`$em->getRepository(E\\Cate|gory::class);`);
    expect(target && isSamePath(target.file, categoryRepository)).toBe(true);
  });

  it('reads an open entity document rather than the file on disk', () => {
    const entityFile = path.join(fixtureApp, 'src', 'Entity', 'Tag.php');
    const openText = (file: string): string | null =>
      isSamePath(file, entityFile)
        ? "<?php\nnamespace App\\Entity;\nuse Doctrine\\ORM\\Mapping as ORM;\n#[ORM\\Entity(repositoryClass: \\App\\Repository\\CategoryRepository::class)]\nclass Tag {}\n"
        : null;
    expect(definition(`$em->getRepository(E\\T|ag::class);`)).toBeNull();
    const target = definition(`$em->getRepository(E\\T|ag::class);`, openText);
    expect(target && isSamePath(target.file, categoryRepository)).toBe(true);
  });

  it.each([
    ['an entity without repositoryClass', `$em->getRepository(E\\T|ag::class);`],
    ['a non-Doctrine Entity attribute', `$em->getRepository(E\\Fa|ke::class);`],
    ['an unknown class', `$em->getRepository(E\\Nop|e::class);`],
    ['a variable', `$em->getRepository($cla|ss);`],
    ['static::class', `$em->getRepository(stat|ic::class);`],
    ['a concatenation', `$em->getRepository('App\\Entity\\' . 'Pro|duct');`],
    ['another method', `$em->find(Pro|duct::class, 1);`],
    ['another named argument', `$em->getRepository(entity: Pro|duct::class);`],
  ])('returns nothing for %s', (_label, code) => {
    expect(definition(code)).toBeNull();
  });
});
