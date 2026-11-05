import type { Node } from 'web-tree-sitter';

/** A statically known PHP value (arrays become lists or string-keyed maps). */
export type PhpValue = string | number | boolean | null | PhpValue[] | { [key: string]: PhpValue };

/** Marker for a value that cannot be known without running PHP (constants, calls, variables...). */
export const UNKNOWN: unique symbol = Symbol('unknown');
export type MaybePhpValue = PhpValue | typeof UNKNOWN;

/** Evaluates a PHP literal expression: strings, numbers, booleans, null and arrays of those. */
export function phpValue(node: Node): MaybePhpValue {
  switch (node.type) {
    case 'string':
      return node.hasError ? UNKNOWN : singleQuotedValue(node.text);
    case 'encapsed_string':
      return doubleQuotedValue(node);
    case 'integer':
      return /^\d+$/.test(node.text) ? Number(node.text) : UNKNOWN;
    case 'boolean':
      return node.text.toLowerCase() === 'true';
    case 'null':
      return null;
    case 'array_creation_expression':
      return arrayValue(node);
    default:
      return UNKNOWN;
  }
}

/** Plain string value of a node, or null if it is not a statically known string. */
export function phpString(node: Node | null | undefined): string | null {
  const value = node ? phpValue(node) : UNKNOWN;
  return typeof value === 'string' ? value : null;
}

/** `'...'`: only `\\` and `\'` are escape sequences. */
function singleQuotedValue(text: string): MaybePhpValue {
  if (text.length < 2 || !text.startsWith("'") || !text.endsWith("'")) {
    return UNKNOWN;
  }
  return text.slice(1, -1).replace(/\\([\\'])/g, '$1');
}

/** `"..."` without interpolation; escape sequences other than `\\`, `\"` and `\$` are not decoded. */
function doubleQuotedValue(node: Node): MaybePhpValue {
  const text = node.text;
  if (node.hasError || text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) {
    return UNKNOWN;
  }
  if (node.namedChildren.some((child) => child?.type !== 'string_content' && child?.type !== 'escape_sequence')) {
    return UNKNOWN;
  }
  const inner = text.slice(1, -1);
  if (/\\[^\\"$]/.test(inner)) {
    return UNKNOWN;
  }
  return inner.replace(/\\([\\"$])/g, '$1');
}

function arrayValue(node: Node): MaybePhpValue {
  const elements = node.namedChildren.filter((child): child is Node => child?.type === 'array_element_initializer');
  if (elements.length !== node.namedChildren.filter((child) => child !== null).length) {
    return UNKNOWN;
  }
  const keyed = elements.some((element) => element.namedChildren.length === 2);
  if (!keyed) {
    const items: PhpValue[] = [];
    for (const element of elements) {
      const value = element.namedChildren[0] ? phpValue(element.namedChildren[0]) : UNKNOWN;
      if (value === UNKNOWN) {
        return UNKNOWN;
      }
      items.push(value);
    }
    return items;
  }
  const map: { [key: string]: PhpValue } = {};
  let nextIndex = 0;
  for (const element of elements) {
    const [first, second] = element.namedChildren;
    const keyValue = second ? (first ? phpValue(first) : UNKNOWN) : nextIndex++;
    const value = (second ?? first) ? phpValue((second ?? first)!) : UNKNOWN;
    if ((typeof keyValue !== 'string' && typeof keyValue !== 'number') || value === UNKNOWN) {
      return UNKNOWN;
    }
    map[String(keyValue)] = value;
  }
  return map;
}
