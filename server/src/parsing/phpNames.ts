import type { Node } from 'web-tree-sitter';

/** Resolves a class name against the file's namespace and `use` imports. */
export function resolveClassName(name: string, root: Node): string {
  if (name.startsWith('\\')) {
    return name.slice(1);
  }
  const [first, ...rest] = name.split('\\');
  for (const clause of root.descendantsOfType('namespace_use_clause')) {
    const imported = clause?.namedChildren[0]?.text.replace(/^\\/, '');
    if (!clause || !imported) {
      continue;
    }
    const alias = clause.childForFieldName('alias')?.text ?? imported.split('\\').pop();
    if (alias === first) {
      return [imported, ...rest].join('\\');
    }
  }
  const namespace = fileNamespace(root);
  return namespace ? `${namespace}\\${name}` : name;
}

export function fileNamespace(root: Node): string | null {
  return root.descendantsOfType('namespace_definition')[0]?.childForFieldName('name')?.text ?? null;
}
