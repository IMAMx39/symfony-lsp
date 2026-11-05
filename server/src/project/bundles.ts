import * as path from 'node:path';
import type { Node } from 'web-tree-sitter';
import { phpStringLiteralValue } from '../parsing/literals';
import type { Parsers } from '../parsing/parsers';
import { resolveClassName } from '../parsing/phpNames';

const BUNDLE_CLASS = 'Symfony\\Component\\HttpKernel\\Bundle\\Bundle';
const ABSTRACT_BUNDLE_CLASS = 'Symfony\\Component\\HttpKernel\\Bundle\\AbstractBundle';

/**
 * Bundle classes of config/bundles.php enabled in `env`, in registration order
 * (`$envs[$env] ?? $envs['all'] ?? false`, as Kernel::registerBundles()).
 * Entries whose class or environments are not plain literals are skipped.
 */
export function enabledBundles(source: string, env: string, parsers: Parsers): string[] {
  const tree = parsers.parse('php', source);
  if (tree === null) {
    return [];
  }
  try {
    const returned = tree.rootNode.descendantsOfType('return_statement')[0]?.namedChildren[0];
    if (returned?.type !== 'array_creation_expression') {
      return [];
    }
    const bundles: string[] = [];
    for (const element of returned.namedChildren) {
      const [key, value] = element?.namedChildren ?? [];
      const className = key && classConstantName(key);
      const envs = value && booleanMap(value);
      if (className && envs && (envs.get(env) ?? envs.get('all') ?? false)) {
        bundles.push(className);
      }
    }
    return bundles;
  } finally {
    tree.delete();
  }
}

/**
 * Root directory of a bundle, as Bundle::getPath() computes it:
 * - an overridden getPath() returning `__DIR__` or `dirname(__DIR__[, levels])`;
 * - otherwise the class directory for Bundle, its parent for AbstractBundle.
 * Returns null when this cannot be determined statically.
 */
export function bundleRootDir(source: string, classFile: string, shortName: string, parsers: Parsers): string | null {
  const tree = parsers.parse('php', source);
  if (tree === null) {
    return null;
  }
  try {
    const declaration = tree.rootNode
      .descendantsOfType('class_declaration')
      .find((node) => node?.childForFieldName('name')?.text === shortName);
    if (!declaration) {
      return null;
    }
    const classDir = path.dirname(classFile);
    const getPath = declaration
      .childForFieldName('body')
      ?.namedChildren.find(
        (member) => member?.type === 'method_declaration' && member.childForFieldName('name')?.text === 'getPath',
      );
    if (getPath) {
      const levels = getPath.childForFieldName('body') && dirLevelsReturned(getPath.childForFieldName('body')!);
      return levels === null || levels === undefined ? null : ancestor(classDir, levels);
    }

    const base = declaration.namedChildren.find((child) => child?.type === 'base_clause')?.namedChildren[0];
    const baseClass = base && resolveClassName(base.text, tree.rootNode);
    if (baseClass === BUNDLE_CLASS) {
      return classDir;
    }
    return baseClass === ABSTRACT_BUNDLE_CLASS ? path.dirname(classDir) : null;
  } finally {
    tree.delete();
  }
}

/** `Foo\BarBundle::class` → `Foo\BarBundle` (bundles.php has no namespace nor imports). */
function classConstantName(node: Node): string | null {
  if (node.type !== 'class_constant_access_expression') {
    return null;
  }
  const [target, constant] = node.namedChildren;
  if (constant?.text !== 'class' || (target?.type !== 'name' && target?.type !== 'qualified_name')) {
    return null;
  }
  return target.text.replace(/^\\/, '');
}

/** `['dev' => true, 'all' => false]` → Map; null if any entry is not a literal. */
function booleanMap(node: Node): Map<string, boolean> | null {
  if (node.type !== 'array_creation_expression') {
    return null;
  }
  const map = new Map<string, boolean>();
  for (const element of node.namedChildren) {
    const [key, value] = element?.namedChildren ?? [];
    const name = key ? phpStringLiteralValue(key) : null;
    const flag = value?.type === 'boolean' ? value.text.toLowerCase() : null;
    if (name === null || (flag !== 'true' && flag !== 'false')) {
      return null;
    }
    map.set(name, flag === 'true');
  }
  return map;
}

/** Number of directory levels above __DIR__ returned by a getPath() body, or null. */
function dirLevelsReturned(body: Node): number | null {
  const statements = body.namedChildren.filter((child) => child?.type !== 'comment');
  const returned = statements.length === 1 && statements[0]?.type === 'return_statement' ? statements[0].namedChildren[0] : null;
  if (!returned) {
    return null;
  }
  if (returned.type === 'name' && returned.text === '__DIR__') {
    return 0;
  }
  if (returned.type !== 'function_call_expression') {
    return null;
  }
  const fn = returned.childForFieldName('function')?.text.replace(/^\\/, '').toLowerCase();
  const args = returned.childForFieldName('arguments')?.namedChildren.map((arg) => arg?.namedChildren[0]) ?? [];
  if (fn !== 'dirname' || args[0]?.text !== '__DIR__' || args.length > 2) {
    return null;
  }
  if (args.length === 1) {
    return 1;
  }
  const levels = args[1]?.type === 'integer' ? Number(args[1].text) : NaN;
  return Number.isInteger(levels) && levels >= 1 ? levels : null;
}

function ancestor(dir: string, levels: number): string {
  let current = dir;
  for (let i = 0; i < levels; i++) {
    current = path.dirname(current);
  }
  return current;
}
