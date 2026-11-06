import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DoctrineEntities } from '../../src/doctrine/DoctrineEntities';
import type { Parsers } from '../../src/parsing/parsers';
import { isSamePath, uriToPath } from '../../src/util/paths';
import { fixtureApp, loadParsers } from '../helpers';

describe('DoctrineEntities', () => {
  let parsers: Parsers;
  let doctrine: DoctrineEntities;

  beforeAll(async () => {
    parsers = await loadParsers();
    doctrine = new DoctrineEntities(fixtureApp, parsers);
  });

  it('lists the mapped fields of an entity, parents and traits included', () => {
    const fields = doctrine.fields('App\\Entity\\Product');
    expect(fields?.map((field) => [field.name, field.kind, field.mapping, field.target])).toEqual([
      ['id', 'field', 'Column', null],
      ['createdAt', 'field', 'Column', null],
      ['name', 'field', 'Column', null],
      ['price', 'field', 'Column', null],
      ['category', 'association', 'ManyToOne', 'App\\Entity\\Category'],
      ['tags', 'association', 'ManyToMany', 'App\\Entity\\Tag'],
      ['warehouse', 'embedded', 'Embedded', 'App\\Entity\\Address'],
      ['published', 'field', 'Column', null],
    ]);
    const id = fields?.find((field) => field.name === 'id');
    expect(id && isSamePath(uriToPath(id.location.uri), path.join(fixtureApp, 'src', 'Entity', 'BaseEntity.php'))).toBe(true);
    expect(id?.location.range.start).toEqual({ line: 12, character: 19 });
    expect(fields?.find((field) => field.name === 'name')?.phpType).toBe('?string');
  });

  it('reads attributes imported by their own name, and embeddables', () => {
    expect(doctrine.fields('App\\Entity\\Category')?.map((field) => [field.name, field.target])).toEqual([
      ['title', null],
      ['products', 'App\\Entity\\Product'],
    ]);
    expect(doctrine.fields('App\\Entity\\Address')?.map((field) => field.name)).toEqual(['city', 'zip']);
  });

  it('knows nothing of unmapped or unknown classes', () => {
    expect(doctrine.fields('App\\Entity\\Fake')).toBeNull();
    expect(doctrine.fields('App\\Entity\\TimestampableTrait')).toBeNull();
    expect(doctrine.fields('App\\Entity\\Nope')).toBeNull();
    expect(doctrine.fields('App\\Controller\\HomeController')).toBeNull();
  });

  it('finds the entity of a repository in its constructor', () => {
    expect(doctrine.entityOfRepository('App\\Repository\\ProductRepository')).toBe('App\\Entity\\Product');
    expect(doctrine.entityOfRepository('App\\Repository\\CategoryRepository')).toBeNull();
  });

  it('prefers open documents', () => {
    const openText = (file: string): string | null =>
      file.endsWith('Address.php')
        ? '<?php\nnamespace App\\Entity;\nuse Doctrine\\ORM\\Mapping as ORM;\n#[ORM\\Embeddable]\nclass Address { #[ORM\\Column] private ?string $street = null; }\n'
        : null;
    expect(doctrine.fields('App\\Entity\\Address', openText)?.map((field) => field.name)).toEqual(['street']);
  });
});
