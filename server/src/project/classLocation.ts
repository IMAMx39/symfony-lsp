import * as fs from 'node:fs';
import { Location, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Parsers } from '../parsing/parsers';
import { fileNamespace } from '../parsing/phpNames';
import { pathToUri } from '../util/paths';
import type { ComposerAutoload } from './ComposerAutoload';

const CLASS_LIKE_DECLARATIONS = ['class_declaration', 'interface_declaration', 'trait_declaration', 'enum_declaration'];

/**
 * Name of a class (or interface, trait, enum) declaration found through PSR-4, or of one of its methods (falls back to
 * the class name when the method is not declared in the class itself). Null when the file
 * does not exist or does not declare the class in the expected namespace.
 */
export function locateClass(autoload: ComposerAutoload, parsers: Parsers, className: string, method?: string): Location | null {
  const fqcn = className.replace(/^\\/, '');
  if (!fqcn.includes('\\')) {
    return null;
  }
  const file = autoload.findClassFile(fqcn);
  const source = file === null ? null : readText(file);
  if (file === null || source === null) {
    return null;
  }
  const tree = parsers.parse('php', source);
  if (tree === null) {
    return null;
  }
  try {
    const shortName = fqcn.split('\\').pop();
    const namespace = fileNamespace(tree.rootNode);
    const declaration = tree.rootNode
      .descendantsOfType(CLASS_LIKE_DECLARATIONS)
      .find((node) => node?.childForFieldName('name')?.text === shortName);
    if (!declaration || (namespace ?? '') !== fqcn.split('\\').slice(0, -1).join('\\')) {
      return null;
    }
    const methodNode =
      method === undefined
        ? null
        : declaration
            .childForFieldName('body')
            ?.namedChildren.find((member) => member?.type === 'method_declaration' && member.childForFieldName('name')?.text === method)
            ?.childForFieldName('name');
    const target = methodNode ?? declaration.childForFieldName('name');
    if (!target) {
      return null;
    }
    const document = TextDocument.create(pathToUri(file), 'php', 0, source);
    return Location.create(document.uri, Range.create(document.positionAt(target.startIndex), document.positionAt(target.endIndex)));
  } finally {
    tree.delete();
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
