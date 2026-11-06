import { Query, type Node } from 'web-tree-sitter';
import { phpStringLiteralValue, twigStringLiteralValue } from '../../parsing/literals';
import type { DocumentLanguage, Parsers } from '../../parsing/parsers';
import phpTranslationsQuery from '../../parsing/queries/php-translations.scm?raw';
import twigTranslationsQuery from '../../parsing/queries/twig-translations.scm?raw';

/** Domain of a message when none is given (Translator::trans()). */
export const DEFAULT_DOMAIN = 'messages';

const TRANS_TAG = /^\{%[-~]?\s*trans(?:\s|[-~]?%\}$)/;
const END_TRANS_TAG = /^\{%[-~]?\s*endtrans\s*[-~]?%\}$/;
const DEFAULT_DOMAIN_TAG = /^\{%[-~]?\s*trans_default_domain\s/;

/** A literal message id in a document. */
export interface TranslationReference {
  key: string;
  /** Null when the domain cannot be known statically (variable, ambiguous default domain). */
  domain: string | null;
  /** Range of the reference: the literal (quotes included) or the body of a `{% trans %}` tag. */
  start: number;
  end: number;
  /** `'literal'` (PHP, `|trans`) or `{% trans %}` body. */
  kind: 'literal' | 'tag';
  /** Range of the key itself (inside the quotes, trimmed body): what completion replaces. */
  keyStart: number;
  keyEnd: number;
}

export class TranslationReferenceFinder {
  private readonly phpQuery: Query;
  private readonly twigQuery: Query;

  constructor(parsers: Parsers) {
    this.phpQuery = new Query(parsers.php, phpTranslationsQuery);
    this.twigQuery = new Query(parsers.twig, twigTranslationsQuery);
  }

  find(language: DocumentLanguage, root: Node): TranslationReference[] {
    return language === 'php' ? this.findInPhp(root) : this.findInTwig(root);
  }

  /** `->trans('id', [...], 'domain')`, positional or named (`id:`, `domain:`) arguments. */
  private findInPhp(root: Node): TranslationReference[] {
    const references: TranslationReference[] = [];
    for (const match of this.phpQuery.matches(root)) {
      const args = match.captures.find((capture) => capture.name === 'arguments')?.node;
      const list = args ? phpArguments(args) : null;
      const idNode = list?.get('id') ?? list?.get(0);
      const key = idNode ? phpStringLiteralValue(idNode) : null;
      if (!list || !idNode || key === null) {
        continue;
      }
      const domainNode = list.get('domain') ?? list.get(2);
      references.push({
        key,
        domain: domainNode === undefined || domainNode.type === 'null' ? DEFAULT_DOMAIN : phpStringLiteralValue(domainNode),
        ...quotedRange(idNode),
      });
    }
    return references;
  }

  private findInTwig(root: Node): TranslationReference[] {
    const defaultDomain = twigDefaultDomain(root);
    const references: TranslationReference[] = [];
    for (const match of this.twigQuery.matches(root)) {
      const keyNode = match.captures.find((capture) => capture.name === 'key')?.node;
      const expression = match.captures.find((capture) => capture.name === 'expression')?.node;
      const key = keyNode ? twigStringLiteralValue(keyNode) : null;
      if (!keyNode || !expression || key === null) {
        continue;
      }
      const args = expression.childForFieldName('arguments');
      const domainNode = args ? twigArgument(args, 'domain', 1) : undefined;
      let domain: string | null;
      if (domainNode === undefined) {
        domain = defaultDomain(expression);
      } else {
        domain = domainNode.type === 'null' ? DEFAULT_DOMAIN : twigStringLiteralValue(domainNode);
      }
      references.push({ key, domain, ...quotedRange(keyNode) });
    }
    const source = root.text;
    for (const tag of root.descendantsOfType('tag')) {
      const reference = tag && TRANS_TAG.test(tag.text) ? transTagReference(tag, source, defaultDomain) : null;
      if (reference) {
        references.push(reference);
      }
    }
    return references.sort((a, b) => a.start - b.start);
  }
}

function quotedRange(node: Node): Pick<TranslationReference, 'start' | 'end' | 'kind' | 'keyStart' | 'keyEnd'> {
  return { start: node.startIndex, end: node.endIndex, kind: 'literal', keyStart: node.startIndex + 1, keyEnd: node.endIndex - 1 };
}

/**
 * PHP arguments by position and by name, or null when they cannot be mapped statically
 * (argument unpacking).
 */
function phpArguments(args: Node): Map<string | number, Node> | null {
  const list = new Map<string | number, Node>();
  let position = 0;
  for (const argument of args.namedChildren) {
    if (argument?.type !== 'argument') {
      continue;
    }
    if (argument.namedChildren.some((child) => child?.type === 'variadic_unpacking')) {
      return null;
    }
    const name = argument.childForFieldName('name');
    const value = argument.namedChildren[argument.namedChildren.length - 1];
    if (!value) {
      continue;
    }
    if (name) {
      list.set(name.text, value);
    } else {
      list.set(position++, value);
    }
  }
  return list;
}

/** A Twig call argument, named or at a position. */
function twigArgument(args: Node, name: string, position: number): Node | undefined {
  let index = 0;
  for (const argument of args.namedChildren) {
    if (!argument) {
      continue;
    }
    if (argument.type === 'named_argument') {
      const key = argument.childForFieldName('key')?.text.replace(/^['"]|['"]$/g, '');
      if (key === name) {
        return argument.childForFieldName('value') ?? undefined;
      }
    } else if (index++ === position) {
      return argument;
    }
  }
  return undefined;
}

/**
 * `{% trans [count n] [with vars] [from 'domain'] [into 'locale'] %}body{% endtrans %}`: the key
 * is the trimmed text body with `%%` unescaped (TransNode::compileString). A body holding
 * anything else than text is a Twig syntax error and is skipped.
 */
function transTagReference(
  tag: Node,
  source: string,
  defaultDomain: (node: Node) => string | null,
): TranslationReference | null {
  let end = tag.nextNamedSibling;
  while (end !== null && end.type === 'content') {
    end = end.nextNamedSibling;
  }
  if (end === null || end.type !== 'tag' || !END_TRANS_TAG.test(end.text)) {
    return null;
  }
  const start = tag.endIndex;
  const body = source.slice(start, end.startIndex);
  const leading = body.length - phpLtrim(body).length;
  const trimmed = phpLtrim(body).length === 0 ? '' : phpRtrim(phpLtrim(body));

  const options = tag.namedChildren.filter((child): child is Node => child !== null);
  const fromIndex = options.findIndex((child) => child.type === 'variable' && child.text === 'from');
  let domain: string | null;
  if (fromIndex === -1) {
    domain = defaultDomain(tag);
  } else {
    const domainNode = options[fromIndex + 1];
    domain = domainNode ? twigStringLiteralValue(domainNode) : null;
  }
  // An empty body is replaced as a whole by completion.
  const keyStart = trimmed === '' ? start : start + leading;
  return {
    key: trimmed.replace(/%%/g, '%'),
    domain,
    start,
    end: end.startIndex,
    kind: 'tag',
    keyStart,
    keyEnd: trimmed === '' ? end.startIndex : keyStart + trimmed.length,
  };
}

/**
 * Domain applied to `|trans` and `{% trans %}` without an explicit domain
 * (TranslationDefaultDomainNodeVisitor). Only the simple case is followed: a single
 * `{% trans_default_domain 'literal' %}` at the top level of the template, for the nodes after
 * it outside an `{% embed %}`. Anything else (several tags, a tag in a block, a variable,
 * nodes before the tag) is ambiguous: null.
 */
function twigDefaultDomain(root: Node): (node: Node) => string | null {
  const tags = root.descendantsOfType('tag').filter((tag): tag is Node => tag !== null && DEFAULT_DOMAIN_TAG.test(tag.text));
  const [tag] = tags;
  if (tag === undefined) {
    return () => DEFAULT_DOMAIN;
  }
  const valueNode = tag.namedChildren[0];
  const domain = tags.length === 1 && tag.parent?.type === 'template' && valueNode ? twigStringLiteralValue(valueNode) : null;
  if (domain === null) {
    return () => null;
  }
  return (node) => (node.startIndex >= tag.endIndex && !hasAncestor(node, 'embed') ? domain : null);
}

function hasAncestor(node: Node, type: string): boolean {
  for (let current = node.parent; current !== null; current = current.parent) {
    if (current.type === type) {
      return true;
    }
  }
  return false;
}

/** PHP's trim() characters: " \t\n\r\0\x0B" (String.prototype.trim also strips Unicode spaces). */
function phpLtrim(text: string): string {
  return text.replace(/^[ \t\n\r\0\x0B]+/, '');
}

function phpRtrim(text: string): string {
  return text.replace(/[ \t\n\r\0\x0B]+$/, '');
}
