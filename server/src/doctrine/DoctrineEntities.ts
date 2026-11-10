import { Location, Range } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Node } from 'web-tree-sitter';
import type { Parsers } from '../parsing/parsers';
import { resolveClassName } from '../parsing/phpNames';
import { ComposerAutoload } from '../project/ComposerAutoload';
import { locateClass } from '../project/classLocation';
import { withClassDeclaration, type OpenText, type ParsedClass } from '../project/classSource';
import { phpClassNameValue } from './phpClassNames';

export const MAPPING = 'Doctrine\\ORM\\Mapping\\';
const ENTITY = `${MAPPING}Entity`;
const MAPPED_SUPERCLASS = `${MAPPING}MappedSuperclass`;
const EMBEDDABLE = `${MAPPING}Embeddable`;
const COLUMN = `${MAPPING}Column`;
const EMBEDDED = `${MAPPING}Embedded`;
const ASSOCIATIONS = ['ManyToOne', 'OneToOne', 'OneToMany', 'ManyToMany'].map((name) => `${MAPPING}${name}`);
/** Associations whose target Doctrine infers from the property type when `targetEntity` is omitted. */
export const TO_ONE = [`${MAPPING}ManyToOne`, `${MAPPING}OneToOne`];

/** Depth limit for parents and traits (guards against cycles). */
const MAX_DEPTH = 8;

export type { OpenText };

export type EntityFieldKind = 'field' | 'association' | 'embedded';

/** A mapped property of an entity (or embeddable). */
export interface EntityField {
  name: string;
  kind: EntityFieldKind;
  /** Mapping attribute short name: `Column`, `ManyToOne`, `Embedded`… */
  mapping: string;
  /** Target entity (association) or embeddable class (embedded), when known. */
  target: string | null;
  /** Declared PHP type of the property, as written. */
  phpType: string | null;
  location: Location;
}

/**
 * Doctrine metadata read on demand from the PHP attributes of the classes found through PSR-4
 * (open documents first): repository class, mapped fields, entity of a repository.
 * XML/YAML mappings are not read.
 */
export class DoctrineEntities {
  private autoload: ComposerAutoload;

  constructor(
    private readonly projectRoot: string,
    private readonly parsers: Parsers,
  ) {
    this.autoload = ComposerAutoload.load(projectRoot);
  }

  /** Composer autoload changed: class files may have moved. */
  reloadAutoload(): void {
    this.autoload = ComposerAutoload.load(this.projectRoot);
  }

  /** `repositoryClass` of the entity's `#[Entity]` attribute: named, or first positional argument. */
  repositoryClassOf(entityClass: string, openText: OpenText = () => null): string | null {
    return this.withClass(entityClass, openText, 'class_declaration', ({ declaration, root }) => {
      const entity = mappingAttributes(declaration, root).find((attribute) => attribute.name === ENTITY);
      const value = entity && attributeArgument(entity.node, 'repositoryClass', 0);
      return value ? phpClassNameValue(value, root) : null;
    });
  }

  /** Declaration of a class through PSR-4 (open documents are not needed for a location). */
  classLocation(className: string): Location | null {
    return locateClass(this.autoload, this.parsers, className);
  }

  /** Declaration of the repository class of an entity. */
  repositoryLocation(entityClass: string, openText?: OpenText): Location | null {
    const repository = this.repositoryClassOf(entityClass, openText);
    return repository === null ? null : locateClass(this.autoload, this.parsers, repository);
  }

  /**
   * Entity managed by a repository: the class literal given to `parent::__construct($registry, X::class)`
   * in its constructor (ServiceEntityRepository).
   */
  entityOfRepository(repositoryClass: string, openText: OpenText = () => null): string | null {
    return this.withClass(repositoryClass, openText, 'class_declaration', ({ declaration, root }) => {
      const constructor = methodNamed(declaration, '__construct');
      for (const call of constructor?.descendantsOfType('scoped_call_expression') ?? []) {
        const scope = call?.childForFieldName('scope');
        if (!call || scope?.text !== 'parent' || call.childForFieldName('name')?.text !== '__construct') {
          continue;
        }
        const args = call.childForFieldName('arguments')?.namedChildren.filter((arg): arg is Node => arg?.type === 'argument') ?? [];
        const argument = args.find((arg) => arg.childForFieldName('name')?.text === 'entityClass') ?? positional(args, 1);
        const value = argument?.namedChildren[argument.namedChildren.length - 1];
        return value ? phpClassNameValue(value, root) : null;
      }
      return null;
    });
  }

  /**
   * Mapped fields of an entity or embeddable, including those of its mapped parents
   * (`#[MappedSuperclass]`, entity inheritance) and of the traits it uses.
   * Null when the class is not found or is not mapped.
   */
  fields(className: string, openText: OpenText = () => null): EntityField[] | null {
    const fields = new Map<string, EntityField>();
    const mapped = this.collectFields(className, openText, fields, 0, true);
    return mapped ? [...fields.values()] : null;
  }

  private collectFields(className: string, openText: OpenText, fields: Map<string, EntityField>, depth: number, requireMapped: boolean): boolean {
    if (depth > MAX_DEPTH) {
      return false;
    }
    const kinds = requireMapped ? 'class_declaration' : ['class_declaration', 'trait_declaration'];
    const found = this.withClass(className, openText, kinds, ({ declaration, root, uri, text }) => {
      const classAttributes = mappingAttributes(declaration, root).map((attribute) => attribute.name);
      const isMapped = classAttributes.some((name) => name === ENTITY || name === MAPPED_SUPERCLASS || name === EMBEDDABLE);
      if (requireMapped && !isMapped) {
        return false;
      }
      // Parents first: a redeclared property overrides the inherited one.
      const parent = declaration.namedChildren.find((child) => child?.type === 'base_clause')?.namedChildren[0];
      if (parent) {
        this.collectFields(resolveClassName(parent.text, root), openText, fields, depth + 1, true);
      }
      const body = declaration.childForFieldName('body');
      for (const member of body?.namedChildren ?? []) {
        if (member?.type === 'use_declaration') {
          for (const trait of member.namedChildren) {
            if (trait?.type === 'name' || trait?.type === 'qualified_name') {
              this.collectFields(resolveClassName(trait.text, root), openText, fields, depth + 1, false);
            }
          }
        }
      }
      for (const field of declaredFields(declaration, root, uri, text)) {
        fields.set(field.name, field);
      }
      return true;
    });
    return found === true;
  }

  private withClass<T>(className: string, openText: OpenText, kinds: string | string[], read: (parsed: ParsedClass) => T): T | null {
    return withClassDeclaration(this.autoload, this.parsers, className, openText, kinds, read);
  }
}

/** Properties of a class body (and promoted constructor parameters) carrying a mapping attribute. */
function declaredFields(declaration: Node, root: Node, uri: string, text: TextDocument): EntityField[] {
  const fields: EntityField[] = [];
  const body = declaration.childForFieldName('body');
  const promoted = methodNamed(declaration, '__construct')?.descendantsOfType('property_promotion_parameter') ?? [];
  const members = [...(body?.namedChildren ?? []).filter((member) => member?.type === 'property_declaration'), ...promoted];
  for (const member of members) {
    if (!member) {
      continue;
    }
    const attributes = mappingAttributes(member, root);
    const mapping = attributes.find(
      (attribute) => attribute.name === COLUMN || attribute.name === EMBEDDED || ASSOCIATIONS.includes(attribute.name),
    );
    if (!mapping) {
      continue;
    }
    const typeNode = member.childForFieldName('type');
    const phpType = typeNode?.text ?? null;
    const kind: EntityFieldKind = mapping.name === COLUMN ? 'field' : mapping.name === EMBEDDED ? 'embedded' : 'association';
    let target: string | null = null;
    if (kind !== 'field') {
      const value = attributeArgument(mapping.node, kind === 'embedded' ? 'class' : 'targetEntity', 0);
      target = value ? phpClassNameValue(value, root) : null;
      if (target === null && value === undefined && (kind === 'embedded' || TO_ONE.includes(mapping.name)) && typeNode) {
        target = singleClassType(typeNode, root);
      }
    }
    const names =
      member.type === 'property_promotion_parameter'
        ? [member.childForFieldName('name')]
        : member.namedChildren.filter((child) => child?.type === 'property_element').map((element) => element?.namedChildren[0] ?? null);
    for (const nameNode of names) {
      const name = nameNode?.text.replace(/^\$/, '');
      if (!nameNode || !name) {
        continue;
      }
      fields.push({
        name,
        kind,
        mapping: mapping.name.slice(MAPPING.length),
        target,
        phpType,
        location: Location.create(uri, Range.create(text.positionAt(nameNode.startIndex), text.positionAt(nameNode.endIndex))),
      });
    }
  }
  return fields;
}

/** `?Category`, `Category|null` → the class name; null for scalars, unions of classes, intersections. */
export function singleClassType(typeNode: Node, root: Node): string | null {
  const names = typeNode.text
    .replace(/^\?/, '')
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.toLowerCase() !== 'null');
  const [only] = names;
  if (names.length !== 1 || only === undefined || !/^\\?[A-Za-z_][\w\\]*$/.test(only) || isBuiltinType(only)) {
    return null;
  }
  return resolveClassName(only, root);
}

function isBuiltinType(name: string): boolean {
  return ['int', 'float', 'string', 'bool', 'array', 'iterable', 'object', 'mixed', 'self', 'static', 'callable', 'false', 'true'].includes(
    name.toLowerCase(),
  );
}

export interface MappingAttribute {
  /** Resolved class name. */
  name: string;
  node: Node;
}

/** Attributes of a declaration (class, property, parameter) whose name resolves under Doctrine\ORM\Mapping. */
export function mappingAttributes(owner: Node, root: Node): MappingAttribute[] {
  const attributes: MappingAttribute[] = [];
  for (const list of owner.namedChildren) {
    if (list?.type !== 'attribute_list') {
      continue;
    }
    for (const attribute of list.descendantsOfType('attribute')) {
      const nameNode = attribute?.namedChildren[0];
      const name = nameNode ? resolveClassName(nameNode.text, root) : null;
      if (attribute && name?.startsWith(MAPPING)) {
        attributes.push({ name, node: attribute });
      }
    }
  }
  return attributes;
}

/**
 * Value of an attribute argument, named or at a position. Undefined when absent; the node may
 * be anything (the caller checks it is a literal).
 */
export function attributeArgument(attribute: Node, name: string, position: number): Node | undefined {
  const args = attribute.childForFieldName('parameters')?.namedChildren.filter((arg): arg is Node => arg?.type === 'argument') ?? [];
  const argument = args.find((arg) => arg.childForFieldName('name')?.text === name) ?? positional(args, position);
  return argument?.namedChildren[argument.namedChildren.length - 1] ?? undefined;
}

/** Positional argument at an index, provided no named argument precedes it. */
function positional(args: Node[], position: number): Node | undefined {
  const candidate = args[position];
  return candidate && args.slice(0, position + 1).every((arg) => arg.childForFieldName('name') === null) ? candidate : undefined;
}

function methodNamed(declaration: Node, name: string): Node | undefined {
  return (
    declaration
      .childForFieldName('body')
      ?.namedChildren.find((member) => member?.type === 'method_declaration' && member.childForFieldName('name')?.text === name) ?? undefined
  );
}
