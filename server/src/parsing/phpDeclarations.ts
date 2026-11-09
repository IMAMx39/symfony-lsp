import type { Node } from 'web-tree-sitter';
import { fileNamespace, resolveClassName } from './phpNames';

/** Type names that are not classes (ReflectionNamedType::isBuiltin(), plus relative names). */
const NON_CLASS_TYPES = new Set([
  'int', 'float', 'string', 'bool', 'array', 'iterable', 'object', 'mixed', 'callable', 'void', 'never', 'null', 'false', 'true',
  'self', 'static', 'parent',
]);

/** Fully qualified name of a declaration of the file. */
export function declaredClassName(declaration: Node, root: Node): string | null {
  const name = declaration.childForFieldName('name')?.text;
  if (!name) {
    return null;
  }
  const namespace = fileNamespace(root);
  return namespace ? `${namespace}\\${name}` : name;
}

/** What a class-like declaration directly extends and implements, resolved. */
export interface Supertypes {
  parent: string | null;
  interfaces: string[];
}

/** `extends` of a class (its parent) or of an interface (more interfaces), and `implements`. */
export function directSupertypes(declaration: Node, root: Node): Supertypes {
  const supertypes: Supertypes = { parent: null, interfaces: [] };
  for (const clause of declaration.namedChildren) {
    if (clause?.type !== 'base_clause' && clause?.type !== 'class_interface_clause') {
      continue;
    }
    const names = clause.namedChildren
      .filter((name): name is Node => name?.type === 'name' || name?.type === 'qualified_name')
      .map((name) => resolveClassName(name.text, root));
    if (clause.type === 'base_clause' && declaration.type === 'class_declaration') {
      supertypes.parent = names[0] ?? null;
    } else {
      supertypes.interfaces.push(...names);
    }
  }
  return supertypes;
}

/** Method declared by the class itself (PHP method names are case-insensitive). */
export function methodNamed(declaration: Node, name: string): Node | undefined {
  return (
    declaration
      .childForFieldName('body')
      ?.namedChildren.find((member) => member?.type === 'method_declaration' && member.childForFieldName('name')?.text.toLowerCase() === name.toLowerCase()) ??
    undefined
  );
}

export function isAbstract(declaration: Node): boolean {
  return declaration.namedChildren.some((child) => child?.type === 'abstract_modifier');
}

/** Attributes directly on a declaration (class or method) whose name resolves to `className`. */
export function attributesNamed(owner: Node, root: Node, className: string): Node[] {
  const attributes: Node[] = [];
  for (const list of owner.namedChildren) {
    if (list?.type !== 'attribute_list') {
      continue;
    }
    for (const attribute of list.descendantsOfType('attribute')) {
      const name = attribute?.namedChildren[0];
      if (attribute && name && resolveClassName(name.text, root) === className) {
        attributes.push(attribute);
      }
    }
  }
  return attributes;
}

/** Class of a `named_type` node, null for a builtin or relative type (`int`, `self`…). */
export function namedTypeClass(named: Node, root: Node): string | null {
  const name = named.namedChildren[0];
  if ((name?.type !== 'name' && name?.type !== 'qualified_name') || NON_CLASS_TYPES.has(name.text.toLowerCase())) {
    return null;
  }
  return resolveClassName(name.text, root);
}

/** The class-like declaration enclosing a node, if any. */
export function enclosingClass(node: Node): Node | null {
  for (let current = node.parent; current !== null; current = current.parent) {
    if (['class_declaration', 'interface_declaration', 'enum_declaration', 'trait_declaration'].includes(current.type)) {
      return current;
    }
  }
  return null;
}
