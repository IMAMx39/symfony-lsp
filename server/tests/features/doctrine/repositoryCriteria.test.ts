import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DoctrineEntities } from '../../../src/doctrine/DoctrineEntities';
import { provideCriteriaCompletion, provideCriteriaDefinition } from '../../../src/features/doctrine/repositoryCriteria';
import { RepositoryCriteriaFinder } from '../../../src/features/doctrine/RepositoryCriteriaFinder';
import type { Parsers } from '../../../src/parsing/parsers';
import { isSamePath, pathToUri, uriToPath } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const entity = (name: string): string => path.join(fixtureApp, 'src', 'Entity', `${name}.php`);
const lineOf = (file: string, text: string): number => fs.readFileSync(file, 'utf8').split(/\r?\n/).findIndex((line) => line.includes(text));

/** A class of the fixture whose body is `body`. */
const controller = (body: string): string => `<?php
namespace App\\Controller;

use App\\Entity\\Product;
use App\\Repository\\ProductRepository;

class ShopController
{
    public function __construct(private ProductRepository $products, private $untyped)
    {
    }

${body}
}
`;

/** ProductRepository itself, with an extra method body. */
const repository = (body: string): string => `<?php
namespace App\\Repository;

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

const CRITERIA_FIELDS = ['id', 'createdAt', 'name', 'price', 'category', 'warehouse.city', 'warehouse.zip', 'published'];

describe('findBy / findOneBy / count criteria', () => {
  let parsers: Parsers;
  let finder: RepositoryCriteriaFinder;
  let doctrine: DoctrineEntities;

  beforeAll(async () => {
    parsers = await loadParsers();
    finder = new RepositoryCriteriaFinder(parsers);
    doctrine = new DoctrineEntities(fixtureApp, parsers);
  });

  const at = (source: string) => {
    const { document, offset } = withCursor(pathToUri(path.join(fixtureApp, 'src', 'Controller', 'ShopController.php')), 'php', source);
    const tree = parsers.parse('php', document.getText())!;
    const references = finder.find(tree.rootNode);
    tree.delete();
    return { document, position: document.positionAt(offset), references };
  };
  const complete = (source: string): string[] | undefined => {
    const { document, position, references } = at(source);
    return provideCriteriaCompletion(document, position, references, doctrine)?.map((item) => item.label);
  };
  const definition = (source: string) => {
    const { document, position, references } = at(source);
    return provideCriteriaDefinition(document, position, references, doctrine);
  };

  it('completes columns, to-one associations and embedded columns of ->getRepository(X)->findOneBy()', () => {
    expect(complete(controller("    public function a($em) { return $em->getRepository(Product::class)->findOneBy(['|' => 1]); }"))).toEqual(CRITERIA_FIELDS);
  });

  it('recognizes $this in a repository, typed properties and parameters, and getRepository() variables', () => {
    for (const source of [
      repository("return $this->findBy(['price' => 1], ['|' => 'ASC']);"),
      controller("    public function a() { return $this->products->count(['|' => 1]); }"),
      controller("    public function a(?ProductRepository $repo) { return $repo->findBy(criteria: ['|' => 1]); }"),
      controller("    public function a($em) {\n        $repo = $em->getRepository(Product::class);\n        return $repo->findBy(['n|']);\n    }"),
    ]) {
      expect(complete(source)).toEqual(CRITERIA_FIELDS);
    }
  });

  it('goes to the property, an embedded column or an association', () => {
    const name = definition(controller("    public function a($em) { return $em->getRepository(Product::class)->findOneBy(['na|me' => 'x']); }"));
    expect(isSamePath(uriToPath(name!.uri), entity('Product'))).toBe(true);
    expect(name!.range.start.line).toBe(lineOf(entity('Product'), '$name'));
    const city = definition(controller("    public function a() { return $this->products->findBy(['warehouse.ci|ty' => 'Paris']); }"));
    expect(isSamePath(uriToPath(city!.uri), entity('Address'))).toBe(true);
    const category = definition(controller("    public function a() { return $this->products->findBy([], ['cate|gory' => 'ASC']); }"));
    expect(category!.range.start.line).toBe(lineOf(entity('Product'), '$category'));
  });

  it('gives nothing when the receiver is not a known repository', () => {
    for (const source of [
      controller("    public function a($repo) { return $repo->findBy(['|' => 1]); }"),
      controller("    public function a() { return $this->untyped->findBy(['|' => 1]); }"),
      controller("    public function a() { return $this->findBy(['|' => 1]); }"),
      controller("    public function a($em) {\n        $repo = $em->getRepository(Product::class);\n        $repo = $other;\n        return $repo->findBy(['|' => 1]);\n    }"),
      controller("    public function a(ProductRepository $repo) { return $repo->findBy($crit|eria); }"),
    ]) {
      expect(complete(source)).toBeUndefined();
    }
    expect(definition(controller("    public function a($em) { return $em->getRepository(Product::class)->findOneBy(['unkn|own' => 1]); }"))).toBeNull();
  });
});
