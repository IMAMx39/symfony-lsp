import type { Node } from 'web-tree-sitter';
import { attributeArgument, MAPPING, mappingAttributes, singleClassType, TO_ONE } from '../../doctrine/DoctrineEntities';
import { phpClassNameValue } from '../../doctrine/phpClassNames';
import { phpStringLiteralValue } from '../../parsing/literals';

/** Options naming a property of the target entity. */
export type MappingOption = 'mappedBy' | 'inversedBy' | 'indexBy';

/**
 * Positions of the options in the constructors of the association attributes (Doctrine ORM 3:
 * ManyToOne, OneToOne, OneToMany, ManyToMany), for positional arguments.
 */
const OPTION_POSITIONS: Readonly<Record<string, Partial<Record<MappingOption, number>>>> = {
  ManyToOne: { inversedBy: 3 },
  OneToOne: { mappedBy: 1, inversedBy: 2 },
  OneToMany: { mappedBy: 1, indexBy: 5 },
  ManyToMany: { mappedBy: 1, inversedBy: 2, indexBy: 6 },
};

/** A literal `mappedBy` / `inversedBy` / `indexBy` value. Offsets cover the literal, quotes included. */
export interface MappingReference {
  option: MappingOption;
  name: string;
  start: number;
  end: number;
  /** Entity the named property belongs to. */
  targetEntity: string;
}

/**
 * Literal `mappedBy`, `inversedBy` and `indexBy` of the association attributes of a PHP file
 * (properties and promoted parameters; attribute names resolved against the `use` imports).
 * Target: `targetEntity` (`X::class` or string), else the property type for ManyToOne / OneToOne
 * (Doctrine's inference); no target, no reference.
 */
export function findMappingReferences(root: Node): MappingReference[] {
  const references: MappingReference[] = [];
  for (const member of [...root.descendantsOfType('property_declaration'), ...root.descendantsOfType('property_promotion_parameter')]) {
    if (!member) {
      continue;
    }
    for (const attribute of mappingAttributes(member, root)) {
      const shortName = attribute.name.slice(MAPPING.length);
      const positions = OPTION_POSITIONS[shortName];
      if (!positions) {
        continue;
      }
      const targetEntity = targetOf(attribute.node, attribute.name, member, root);
      if (targetEntity === null) {
        continue;
      }
      for (const [option, position] of Object.entries(positions) as Array<[MappingOption, number]>) {
        const value = attributeArgument(attribute.node, option, position);
        const name = value ? phpStringLiteralValue(value) : null;
        if (value && name !== null) {
          references.push({ option, name, start: value.startIndex, end: value.endIndex, targetEntity });
        }
      }
    }
  }
  return references;
}

function targetOf(attribute: Node, attributeName: string, member: Node, root: Node): string | null {
  const value = attributeArgument(attribute, 'targetEntity', 0);
  if (value) {
    return phpClassNameValue(value, root);
  }
  const type = member.childForFieldName('type');
  return TO_ONE.includes(attributeName) && type ? singleClassType(type, root) : null;
}
