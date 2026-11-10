import { SemanticTokensBuilder, type SemanticTokens, type SemanticTokensLegend } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { DoctrineEntities, OpenText } from '../../doctrine/DoctrineEntities';
import { dqlPaths, resolveDqlField, type DqlPath } from './dqlPaths';
import type { QueryBuilderReference } from './QueryBuilderReferenceFinder';

/** Token types of the DQL highlighting, in legend order. */
export const DQL_TOKEN_LEGEND: SemanticTokensLegend = {
  tokenTypes: ['variable', 'property', 'parameter', 'keyword', 'function'],
  tokenModifiers: [],
};

const VARIABLE = 0;
const PROPERTY = 1;
const PARAMETER = 2;
const KEYWORD = 3;
const FUNCTION = 4;

/** Reserved words of the DQL grammar (Doctrine ORM Lexer), compared case-insensitively. */
const KEYWORDS = new Set(
  [
    'ALL', 'AND', 'ANY', 'AS', 'ASC', 'BETWEEN', 'BY', 'CASE', 'DELETE', 'DESC', 'DISTINCT', 'ELSE', 'EMPTY', 'END',
    'ESCAPE', 'EXISTS', 'FALSE', 'FROM', 'GROUP', 'HAVING', 'HIDDEN', 'IN', 'INDEX', 'INNER', 'INSTANCE', 'IS', 'JOIN',
    'LEADING', 'LEFT', 'LIKE', 'MEMBER', 'NEW', 'NOT', 'NULL', 'OF', 'OR', 'ORDER', 'OUTER', 'PARTIAL', 'SELECT', 'SET',
    'SOME', 'THEN', 'TRAILING', 'TRUE', 'UPDATE', 'WHEN', 'WHERE', 'WITH', 'BOTH',
  ],
);

/** Positional (`?1`) and named (`:id`) parameters. */
const PARAMETERS = /(?<![\w:?])(?::[A-Za-z_]\w*|\?\d+)/g;
/** DQL string literals (`'done'`, `''` escapes a quote): blanked before looking for identifiers. */
const DQL_STRINGS = /'(?:[^']|'')*'/g;

interface Token {
  start: number;
  length: number;
  type: number;
}

/**
 * Semantic tokens of the DQL strings of QueryBuilder calls: aliases of the query builder,
 * mapped fields after an alias (unknown fields stay plain), parameters, DQL keywords and
 * function names. Literals are plain (no escapes), so offsets map to the source.
 */
export function provideDqlSemanticTokens(
  document: TextDocument,
  references: readonly QueryBuilderReference[],
  doctrine: DoctrineEntities,
  openText?: OpenText,
): SemanticTokens {
  const text = document.getText();
  const tokens: Token[] = [];
  for (const reference of references) {
    const contentStart = reference.start + 1;
    const content = text.slice(contentStart, reference.end - 1);
    for (const match of content.matchAll(PARAMETERS)) {
      tokens.push({ start: contentStart + match.index, length: match[0].length, type: PARAMETER });
    }
    const code = content.replace(DQL_STRINGS, (literal) => ' '.repeat(literal.length));
    for (const path of dqlPaths(code, contentStart)) {
      tokens.push(...pathTokens(path, code, contentStart, reference, doctrine, openText));
    }
  }
  tokens.sort((a, b) => a.start - b.start);
  const builder = new SemanticTokensBuilder();
  for (const token of tokens) {
    const position = document.positionAt(token.start);
    builder.push(position.line, position.character, token.length, token.type, 0);
  }
  return builder.build();
}

function pathTokens(
  path: DqlPath,
  code: string,
  contentStart: number,
  reference: QueryBuilderReference,
  doctrine: DoctrineEntities,
  openText: OpenText | undefined,
): Token[] {
  const [first] = path.segments;
  if (!first) {
    return [];
  }
  const token = (segment: { start: number; end: number }, type: number): Token => ({ start: segment.start, length: segment.end - segment.start, type });
  if (reference.aliases.has(first.name)) {
    const tokens = [token(first, VARIABLE)];
    for (let index = 1; index < path.segments.length; index++) {
      const segment = path.segments[index];
      if (!segment || resolveDqlField(path, index, reference.aliases, doctrine, openText) === null) {
        break;
      }
      tokens.push(token(segment, PROPERTY));
    }
    return tokens;
  }
  if (path.segments.length !== 1) {
    return [];
  }
  if (KEYWORDS.has(first.name.toUpperCase())) {
    return [token(first, KEYWORD)];
  }
  const following = code.slice(first.end - contentStart);
  return /^\s*\(/.test(following) ? [token(first, FUNCTION)] : [];
}
