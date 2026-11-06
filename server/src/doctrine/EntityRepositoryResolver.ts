import * as fs from 'node:fs';
import type { Location } from 'vscode-languageserver';
import type { Node } from 'web-tree-sitter';
import type { Parsers } from '../parsing/parsers';
import { fileNamespace, resolveClassName } from '../parsing/phpNames';
import { ComposerAutoload } from '../project/ComposerAutoload';
import { locateClass } from '../project/classLocation';
import { phpClassNameValue } from './phpClassNames';

const ENTITY_ATTRIBUTE = 'Doctrine\\ORM\\Mapping\\Entity';

/** Content of a file: an open document when there is one, else null to read the disk. */
export type OpenText = (file: string) => string | null;

/**
 * Repository of a Doctrine entity, from its `#[ORM\Entity(repositoryClass: ...)]` attribute,
 * read on demand from the entity file found through PSR-4. Entities without `repositoryClass`
 * get the configured default repository (or a repository factory): unknown here.
 */
export class EntityRepositoryResolver {
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

  repositoryClassOf(entityClass: string, openText: OpenText = () => null): string | null {
    const fqcn = entityClass.replace(/^\\/, '');
    const file = this.autoload.findClassFile(fqcn);
    const source = file === null ? null : (openText(file) ?? readText(file));
    const tree = source === null ? null : this.parsers.parse('php', source);
    if (tree === null) {
      return null;
    }
    try {
      const root = tree.rootNode;
      const shortName = fqcn.split('\\').pop();
      const declaration = root
        .descendantsOfType('class_declaration')
        .find((node) => node?.childForFieldName('name')?.text === shortName);
      if (!declaration || (fileNamespace(root) ?? '') !== fqcn.split('\\').slice(0, -1).join('\\')) {
        return null;
      }
      return entityRepositoryArgument(declaration, root);
    } finally {
      tree.delete();
    }
  }

  /** Declaration of the repository class of an entity. */
  repositoryLocation(entityClass: string, openText?: OpenText): Location | null {
    const repository = this.repositoryClassOf(entityClass, openText);
    return repository === null ? null : locateClass(this.autoload, this.parsers, repository);
  }
}

/** `repositoryClass` of the class's `#[Entity]` attribute: named, or first positional argument. */
function entityRepositoryArgument(declaration: Node, root: Node): string | null {
  for (const list of declaration.namedChildren) {
    if (list?.type !== 'attribute_list') {
      continue;
    }
    for (const attribute of list.descendantsOfType('attribute')) {
      const name = attribute?.namedChildren[0];
      if (!attribute || !name || resolveClassName(name.text, root) !== ENTITY_ATTRIBUTE) {
        continue;
      }
      const args = attribute.childForFieldName('parameters')?.namedChildren.filter((arg): arg is Node => arg?.type === 'argument') ?? [];
      const argument =
        args.find((arg) => arg.childForFieldName('name')?.text === 'repositoryClass') ??
        (args[0] && args[0].childForFieldName('name') === null ? args[0] : undefined);
      const value = argument?.namedChildren[argument.namedChildren.length - 1];
      return value ? phpClassNameValue(value, root) : null;
    }
  }
  return null;
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
