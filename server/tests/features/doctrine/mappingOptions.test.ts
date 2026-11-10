import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DoctrineEntities } from '../../../src/doctrine/DoctrineEntities';
import { findMappingReferences } from '../../../src/features/doctrine/MappingReferenceFinder';
import { provideMappingCompletion, provideMappingDefinition } from '../../../src/features/doctrine/mappingOptions';
import type { Parsers } from '../../../src/parsing/parsers';
import { isSamePath, pathToUri, uriToPath } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const entity = (name: string): string => path.join(fixtureApp, 'src', 'Entity', `${name}.php`);
const lineOf = (file: string, text: string): number => fs.readFileSync(file, 'utf8').split(/\r?\n/).findIndex((line) => line.includes(text));

/** An open entity of the fixture namespace whose class body is `body`. */
const entitySource = (body: string): string => `<?php
namespace App\\Entity;

use Doctrine\\ORM\\Mapping as ORM;
use Doctrine\\ORM\\Mapping\\OneToMany;

#[ORM\\Entity]
class Shelf
{
${body}
}
`;

describe('mappedBy / inversedBy / indexBy', () => {
  let parsers: Parsers;
  let doctrine: DoctrineEntities;

  beforeAll(async () => {
    parsers = await loadParsers();
    doctrine = new DoctrineEntities(fixtureApp, parsers);
  });

  const at = (source: string) => {
    const { document, offset } = withCursor(pathToUri(entity('Shelf')), 'php', source);
    const tree = parsers.parse('php', document.getText())!;
    const references = findMappingReferences(tree.rootNode);
    tree.delete();
    return { document, position: document.positionAt(offset), references };
  };

  describe('references', () => {
    const options = (body: string) =>
      at(entitySource(body.replace('|', '') + '|')).references.map((reference) => [reference.option, reference.name, reference.targetEntity]);

    it('reads named and positional options, with the target entity', () => {
      expect(
        options(
          [
            "    #[ORM\\OneToMany(targetEntity: Product::class, mappedBy: 'shelf', indexBy: 'name')]",
            '    private $products;',
            "    #[ORM\\ManyToMany('App\\Entity\\Tag', 'shelves', null, ['persist'], 'LAZY', false, 'label')]",
            '    private $tags;',
            "    #[OneToMany(mappedBy: 'shelf', targetEntity: Category::class)]",
            '    private $categories;',
          ].join('\n'),
        ),
      ).toEqual([
        ['mappedBy', 'shelf', 'App\\Entity\\Product'],
        ['indexBy', 'name', 'App\\Entity\\Product'],
        ['mappedBy', 'shelves', 'App\\Entity\\Tag'],
        ['indexBy', 'label', 'App\\Entity\\Tag'],
        ['mappedBy', 'shelf', 'App\\Entity\\Category'],
      ]);
    });

    it('infers the target of a to-one association from the property type, not of a to-many one', () => {
      expect(
        options(
          [
            "    #[ORM\\ManyToOne(inversedBy: 'shelves')]",
            '    private ?Category $category = null;',
            "    #[ORM\\OneToMany(mappedBy: 'shelf')]",
            '    private Collection $orphans;',
            "    #[ORM\\ManyToOne(inversedBy: 'x')]",
            '    private string $scalar;',
          ].join('\n'),
        ),
      ).toEqual([['inversedBy', 'shelves', 'App\\Entity\\Category']]);
    });
  });

  it('goes to the inverse property of the fixture associations', () => {
    const products = at(entitySource("    #[ORM\\ManyToOne(inversedBy: 'prod|ucts')]\n    private ?Category $category = null;"));
    const location = provideMappingDefinition(products.document, products.position, products.references, doctrine);
    expect(isSamePath(uriToPath(location!.uri), entity('Category'))).toBe(true);
    expect(location!.range.start.line).toBe(lineOf(entity('Category'), '$products'));

    const category = at(entitySource("    #[OneToMany(targetEntity: Product::class, mappedBy: 'cate|gory')]\n    private $products;"));
    const owning = provideMappingDefinition(category.document, category.position, category.references, doctrine);
    expect(owning!.range.start.line).toBe(lineOf(entity('Product'), '$category'));
  });

  it('completes associations for mappedBy / inversedBy and columns for indexBy', () => {
    const complete = (body: string): string[] | undefined => {
      const { document, position, references } = at(entitySource(body));
      return provideMappingCompletion(document, position, references, doctrine)?.map((item) => item.label);
    };
    expect(complete("    #[ORM\\OneToMany(targetEntity: Product::class, mappedBy: '|')]\n    private $products;")).toEqual(['category', 'tags']);
    expect(complete("    #[ORM\\OneToMany(targetEntity: Product::class, mappedBy: 'category', indexBy: 'n|')]\n    private $products;")).toEqual([
      'id',
      'createdAt',
      'name',
      'price',
      'published',
    ]);
    expect(complete("    #[ORM\\OneToMany(targetEntity: Unknown::class, mappedBy: '|')]\n    private $products;")).toBeUndefined();
  });
});
