import type { Node } from 'web-tree-sitter';
import { phpStringLiteralValue } from '../parsing/literals';
import { resolveClassName } from '../parsing/phpNames';

/**
 * Fully qualified class name given by an expression: `Foo::class` (resolved against the `use`
 * imports of the file) or a string literal (always fully qualified). Null for anything else
 * (`static::class`, `$x::class`, interpolation…).
 */
export function phpClassNameValue(node: Node, root: Node): string | null {
  if (node.type === 'class_constant_access_expression') {
    const [target, constant] = node.namedChildren;
    if (constant?.text !== 'class' || (target?.type !== 'name' && target?.type !== 'qualified_name')) {
      return null;
    }
    return resolveClassName(target.text, root);
  }
  const value = node.type === 'string' ? singleQuotedValue(node) : phpStringLiteralValue(node);
  return value === null || value === '' ? null : value.replace(/^\\/, '');
}

/** `'App\Entity\Foo'`: in single quotes only `\\` and `\'` are escapes, other backslashes are literal. */
function singleQuotedValue(node: Node): string | null {
  const text = node.text;
  if (node.hasError || text.length < 2 || !text.startsWith("'") || !text.endsWith("'")) {
    return null;
  }
  return text.slice(1, -1).replace(/\\([\\'])/g, '$1');
}
