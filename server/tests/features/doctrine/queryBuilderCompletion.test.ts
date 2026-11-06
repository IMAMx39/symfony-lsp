import * as path from 'node:path';
import type { TextEdit } from 'vscode-languageserver';
import { beforeAll, describe, expect, it } from 'vitest';
import { DoctrineEntities } from '../../../src/doctrine/DoctrineEntities';
import { provideQueryBuilderCompletion } from '../../../src/features/doctrine/queryBuilderCompletion';
import { QueryBuilderReferenceFinder } from '../../../src/features/doctrine/QueryBuilderReferenceFinder';
import type { Parsers } from '../../../src/parsing/parsers';
import { isSamePath, pathToUri } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const repositoryFile = path.join(fixtureApp, 'src', 'Repository', 'ProductRepository.php');

/** An open ProductRepository whose method body is `body`. */
const repository = (body: string): string => `<?php
namespace App\\Repository;

use App\\Entity\\Product;
use App\\Entity as E;

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

const PRODUCT_FIELDS = ['id', 'createdAt', 'name', 'price', 'category', 'tags', 'warehouse', 'published'];

describe('QueryBuilder completion', () => {
  let parsers: Parsers;
  let finder: QueryBuilderReferenceFinder;
  let doctrine: DoctrineEntities;

  beforeAll(async () => {
    parsers = await loadParsers();
    finder = new QueryBuilderReferenceFinder(parsers);
    doctrine = new DoctrineEntities(fixtureApp, parsers);
  });

  function complete(body: string) {
    const { document, offset } = withCursor(pathToUri(repositoryFile), 'php', repository(body));
    const tree = parsers.parse('php', document.getText())!;
    const references = finder.find(tree.rootNode);
    tree.delete();
    const openText = (file: string): string | null => (isSamePath(file, repositoryFile) ? document.getText() : null);
    const items = provideQueryBuilderCompletion(document, document.positionAt(offset), references, doctrine, openText);
    const apply = (label: string): string => {
      const edit = items?.find((item) => item.label === label)?.textEdit as TextEdit;
      const text = document.getText();
      return text.slice(0, document.offsetAt(edit.range.start)) + edit.newText + text.slice(document.offsetAt(edit.range.end));
    };
    return { labels: items?.map((item) => item.label) ?? null, apply };
  }

  it('completes the fields of the repository entity', () => {
    const { labels, apply } = complete(`return $this->createQueryBuilder('p')->andWhere('p.na|me = :name')->getQuery()->getResult();`);
    expect(labels).toEqual(PRODUCT_FIELDS);
    expect(apply('price')).toContain(`->andWhere('p.price = :name')`);
  });

  it.each([
    ['a variable', `$qb = $this->createQueryBuilder('p');\n$qb->orderBy('p.|');`],
    ['a reassigned variable', `$qb = $this->createQueryBuilder('p');\n$qb = $qb->andWhere('x = 1');\n$qb->addOrderBy('p.|', 'DESC');`],
    ['an array of selects', `$this->createQueryBuilder('p')->select(['p.id', 'p.|']);`],
    ['from()', `$this->getEntityManager()->createQueryBuilder()->select('x')->from(Product::class, 'x')->where('x.|');`],
    ['a named from()', `$em->createQueryBuilder()->from(alias: 'x', from: 'App\\Entity\\Product')->where('x.| = 1');`],
    ['several paths in one string', `$this->createQueryBuilder('p')->where('p.name = :n AND p.|');`],
  ])('follows %s', (_label, body) => {
    expect(complete(body).labels).toEqual(PRODUCT_FIELDS);
  });

  it('follows joins on associations and on entity classes', () => {
    expect(complete(`$this->createQueryBuilder('p')->leftJoin('p.category', 'c')->andWhere('c.|');`).labels).toEqual(['title', 'products']);
    expect(complete(`$qb = $this->createQueryBuilder('p');\n$qb->join('p.category', 'c');\n$qb->innerJoin('c.products', 'o')->where('o.|');`).labels).toEqual(PRODUCT_FIELDS);
    expect(complete(`$this->createQueryBuilder('p')->join(E\\Category::class, 'k', 'WITH', 'k.|');`).labels).toEqual(['title', 'products']);
  });

  it('follows embedded objects', () => {
    expect(complete(`$this->createQueryBuilder('p')->where('p.warehouse.|');`).labels).toEqual(['city', 'zip']);
  });

  it.each([
    ['an unknown alias', `$this->createQueryBuilder('p')->where('q.|');`],
    ['a parameter', `$this->createQueryBuilder('p')->where('p.id = :p.|');`],
    ['a longer path', `$this->createQueryBuilder('p')->where('p.category.|');`],
    ['an alias declared twice', `$this->createQueryBuilder('p')->leftJoin('p.category', 'c')->leftJoin('p.tags', 'c')->where('c.|');`],
    ['a variable assigned from elsewhere', `$qb = $this->createQueryBuilder('p');\n$qb = $other;\n$qb->where('p.|');`],
    ['a variable never created here', `$qb->where('p.|');`],
    ['a dynamic string', `$this->createQueryBuilder('p')->where("p.{$field}|");`],
    ['another method', `$this->createQueryBuilder('p')->setParameter('p.|', 1);`],
    ['a builder that is not a query builder', `$this->other('p')->where('p.|');`],
    ['an entity manager builder without from()', `$em->createQueryBuilder('p')->where('p.|');`],
  ])('proposes nothing for %s', (_label, body) => {
    expect(complete(body).labels).toBeNull();
  });
});
