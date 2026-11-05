import type { Node } from 'web-tree-sitter';

/**
 * Value of a PHP string literal, or null when it is not a plain literal:
 * interpolation, escape sequences or syntax errors make the value uncertain.
 */
export function phpStringLiteralValue(node: Node): string | null {
  const quote = node.type === 'string' ? "'" : node.type === 'encapsed_string' ? '"' : null;
  if (quote === null || node.hasError) {
    return null;
  }
  if (node.type === 'encapsed_string' && node.namedChildren.some((child) => child?.type !== 'string_content')) {
    return null;
  }
  return unquote(node.text, quote);
}

/**
 * Value of a Twig string literal (`'...'` or `"..."`), or null when it is not a plain
 * literal. Interpolated strings (`"#{x}"`) are a distinct node type and are rejected.
 */
export function twigStringLiteralValue(node: Node): string | null {
  if (node.type !== 'string' || node.hasError) {
    return null;
  }
  const quote = node.text[0];
  return quote === "'" || quote === '"' ? unquote(node.text, quote) : null;
}

function unquote(text: string, quote: string): string | null {
  if (text.length < 2 || !text.startsWith(quote) || !text.endsWith(quote)) {
    return null;
  }
  const value = text.slice(1, -1);
  return value.includes('\\') ? null : value;
}
