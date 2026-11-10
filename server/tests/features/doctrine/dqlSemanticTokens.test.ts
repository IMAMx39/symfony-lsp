import * as path from 'node:path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { beforeAll, describe, expect, it } from 'vitest';
import { DoctrineEntities } from '../../../src/doctrine/DoctrineEntities';
import { DQL_TOKEN_LEGEND, provideDqlSemanticTokens } from '../../../src/features/doctrine/dqlSemanticTokens';
import { QueryBuilderReferenceFinder } from '../../../src/features/doctrine/QueryBuilderReferenceFinder';
import type { Parsers } from '../../../src/parsing/parsers';
import { pathToUri } from '../../../src/util/paths';
import { fixtureApp, loadParsers } from '../../helpers';

/** Decodes LSP relative tokens into `text:type` strings. */
function decode(document: TextDocument, data: number[]): string[] {
  const tokens: string[] = [];
  let line = 0;
  let character = 0;
  for (let index = 0; index < data.length; index += 5) {
    const [deltaLine, deltaStart, length, type] = data.slice(index, index + 4) as [number, number, number, number];
    line += deltaLine;
    character = deltaLine === 0 ? character + deltaStart : deltaStart;
    const start = document.offsetAt({ line, character });
    tokens.push(`${document.getText().slice(start, start + length)}:${DQL_TOKEN_LEGEND.tokenTypes[type]}`);
  }
  return tokens;
}

describe('DQL semantic tokens', () => {
  let parsers: Parsers;
  let finder: QueryBuilderReferenceFinder;
  let doctrine: DoctrineEntities;

  beforeAll(async () => {
    parsers = await loadParsers();
    finder = new QueryBuilderReferenceFinder(parsers);
    doctrine = new DoctrineEntities(fixtureApp, parsers);
  });

  const tokens = (body: string): string[] => {
    const source = `<?php\nuse App\\Entity\\Product;\n\nfunction search($em) {\n    return $em->createQueryBuilder()\n${body};\n}\n`;
    const document = TextDocument.create(pathToUri(path.join(fixtureApp, 'src', 'Search.php')), 'php', 1, source);
    const tree = parsers.parse('php', source)!;
    const result = decode(document, provideDqlSemanticTokens(document, finder.find(tree.rootNode), doctrine).data);
    tree.delete();
    return result;
  };

  it('marks aliases, resolved fields, parameters and keywords', () => {
    expect(
      tokens(
        [
          "        ->select('p')",
          "        ->from(Product::class, 'p')",
          "        ->join('p.category', 'c')",
          "        ->where('p.name = :name AND c.title IS NOT NULL')",
          "        ->andWhere('p.price > ?1')",
        ].join('\n'),
      ),
    ).toEqual([
      'p:variable',
      'p:variable',
      'p:variable',
      'category:property',
      'c:variable',
      'p:variable',
      'name:property',
      ':name:parameter',
      'AND:keyword',
      'c:variable',
      'title:property',
      'IS:keyword',
      'NOT:keyword',
      'NULL:keyword',
      'p:variable',
      'price:property',
      '?1:parameter',
    ]);
  });

  it('marks functions and embedded fields, leaves unknown fields, aliases and DQL strings plain', () => {
    expect(
      tokens(
        [
          "        ->from(Product::class, 'p')",
          "        ->select('COUNT(p.id), lower(p.warehouse.city)')",
          "        ->where(\"p.unknown = 1 AND x.name = 'and' AND p.name LIKE 'select%'\")",
        ].join('\n'),
      ),
    ).toEqual([
      'p:variable',
      'COUNT:function',
      'p:variable',
      'id:property',
      'lower:function',
      'p:variable',
      'warehouse:property',
      'city:property',
      'p:variable',
      'AND:keyword',
      'AND:keyword',
      'p:variable',
      'name:property',
      'LIKE:keyword',
    ]);
  });
});
