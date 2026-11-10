import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DoctrineEntities } from '../../../src/doctrine/DoctrineEntities';
import { provideQueryBuilderDefinition } from '../../../src/features/doctrine/definition';
import { QueryBuilderReferenceFinder } from '../../../src/features/doctrine/QueryBuilderReferenceFinder';
import type { Parsers } from '../../../src/parsing/parsers';
import { isSamePath, pathToUri, uriToPath } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const repositoryFile = path.join(fixtureApp, 'src', 'Repository', 'ProductRepository.php');
const entity = (name: string): string => path.join(fixtureApp, 'src', 'Entity', `${name}.php`);

/** An open ProductRepository whose method body is `body`. */
const repository = (body: string): string => `<?php
namespace App\\Repository;

use App\\Entity\\Category;
use App\\Entity\\Product;

class ProductRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Product::class);
    }

    public function search(): array
    {
        ${body}
    }
}
`;

describe('QueryBuilder definition', () => {
  let parsers: Parsers;
  let finder: QueryBuilderReferenceFinder;
  let doctrine: DoctrineEntities;

  beforeAll(async () => {
    parsers = await loadParsers();
    finder = new QueryBuilderReferenceFinder(parsers);
    doctrine = new DoctrineEntities(fixtureApp, parsers);
  });

  function definition(body: string) {
    const { document, offset } = withCursor(pathToUri(repositoryFile), 'php', repository(body));
    const tree = parsers.parse('php', document.getText())!;
    const references = finder.find(tree.rootNode);
    tree.delete();
    return provideQueryBuilderDefinition(document, document.positionAt(offset), references, doctrine);
  }

  /** Line of the first line of `file` containing `text`. */
  const lineOf = (file: string, text: string): number => fs.readFileSync(file, 'utf8').split(/\r?\n/).findIndex((line) => line.includes(text));

  it('goes to the property of a field, inherited ones included', () => {
    const name = definition("return $this->createQueryBuilder('p')->where('p.na|me = :name')->getQuery()->getResult();");
    expect(isSamePath(uriToPath(name!.uri), entity('Product'))).toBe(true);
    expect(name!.range.start.line).toBe(lineOf(entity('Product'), '$name'));
    const id = definition("return $this->createQueryBuilder('p')->orderBy('p.id|', 'ASC');");
    expect(isSamePath(uriToPath(id!.uri), entity('BaseEntity'))).toBe(true);
  });

  it('follows joined associations and embedded objects', () => {
    const joined = definition("return $this->createQueryBuilder('p')->join('p.category', 'c')->andWhere('c.ti|tle = :t');");
    expect(isSamePath(uriToPath(joined!.uri), entity('Category'))).toBe(true);
    const association = definition("return $this->createQueryBuilder('p')->join('p.cat|egory', 'c');");
    expect(association!.range.start.line).toBe(lineOf(entity('Product'), '$category'));
    const embedded = definition("return $this->createQueryBuilder('p')->select('p.warehouse.ci|ty');");
    expect(isSamePath(uriToPath(embedded!.uri), entity('Address'))).toBe(true);
  });

  it('goes to the entity of an alias, from from() or the repository', () => {
    const fromAlias = definition("$qb = $this->getEntityManager()->createQueryBuilder()->select('c')->from(Category::class, 'c')->where('|c.title = 1');");
    expect(isSamePath(uriToPath(fromAlias!.uri), entity('Category'))).toBe(true);
    const repositoryAlias = definition("return $this->createQueryBuilder('p')->select('p|');");
    expect(isSamePath(uriToPath(repositoryAlias!.uri), entity('Product'))).toBe(true);
  });

  it('returns nothing for parameters, unknown aliases or fields, and paths through associations', () => {
    expect(definition("return $this->createQueryBuilder('p')->where('p.name = :na|me');")).toBeNull();
    expect(definition("return $this->createQueryBuilder('p')->where('x.na|me = 1');")).toBeNull();
    expect(definition("return $this->createQueryBuilder('p')->where('p.unkn|own = 1');")).toBeNull();
    expect(definition("return $this->createQueryBuilder('p')->where('p.category.ti|tle = 1');")).toBeNull();
    expect(definition("return $this->createQueryBuilder('p')->where('p.name = 1 A|ND p.price > 2');")).toBeNull();
  });
});
