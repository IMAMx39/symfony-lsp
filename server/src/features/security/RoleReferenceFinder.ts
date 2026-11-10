import { Query, type Node } from 'web-tree-sitter';
import { phpStringLiteralValue, twigStringLiteralValue } from '../../parsing/literals';
import type { DocumentLanguage, Parsers } from '../../parsing/parsers';
import { resolveClassName } from '../../parsing/phpNames';
import phpRolesQuery from '../../parsing/queries/php-roles.scm?raw';
import twigRolesQuery from '../../parsing/queries/twig-roles.scm?raw';
import type { RoleReference } from '../../security/securityYaml';

const IS_GRANTED_ATTRIBUTE = 'Symfony\\Component\\Security\\Http\\Attribute\\IsGranted';

/** Position and accepted names of the attribute argument, by PHP method. */
const PHP_METHODS: Readonly<Record<string, { position: number; names: string[] }>> = {
  // AbstractController and AuthorizationCheckerInterface name it `attribute`, Security `attributes`.
  isGranted: { position: 0, names: ['attribute', 'attributes'] },
  denyAccessUnlessGranted: { position: 0, names: ['attribute'] },
  isGrantedForUser: { position: 1, names: ['attribute'] },
};

/** Position of the attribute argument, by Twig function (positional arguments only). */
const TWIG_FUNCTIONS: Readonly<Record<string, number>> = { is_granted: 0, is_granted_for_user: 1 };

/**
 * Literal roles (security attributes) given to isGranted() checks: `->isGranted()`,
 * `->denyAccessUnlessGranted()`, `->isGrantedForUser()` and `#[IsGranted]` in PHP (whatever the
 * object), `is_granted()` and `is_granted_for_user()` in Twig. Expressions, closures, variables,
 * concatenations and argument unpacking give nothing.
 */
export class RoleReferenceFinder {
  private readonly phpQuery: Query;
  private readonly twigQuery: Query;

  constructor(parsers: Parsers) {
    this.phpQuery = new Query(parsers.php, phpRolesQuery);
    this.twigQuery = new Query(parsers.twig, twigRolesQuery);
  }

  find(language: DocumentLanguage, root: Node): RoleReference[] {
    const references: RoleReference[] = [];
    const query = language === 'php' ? this.phpQuery : this.twigQuery;
    for (const match of query.matches(root)) {
      const args = match.captures.find((capture) => capture.name === 'arguments')?.node;
      if (!args) {
        continue;
      }
      let node: Node | undefined;
      if (language === 'twig') {
        const name = match.captures.find((capture) => capture.name === 'function')?.node.text;
        const position = name === undefined ? undefined : TWIG_FUNCTIONS[name];
        node = position === undefined ? undefined : args.namedChildren.filter((child): child is Node => child !== null)[position];
      } else {
        const method = match.captures.find((capture) => capture.name === 'method')?.node.text;
        const attribute = match.captures.find((capture) => capture.name === 'attribute')?.node;
        const signature =
          method !== undefined
            ? PHP_METHODS[method]
            : attribute && resolveClassName(attribute.text, root) === IS_GRANTED_ATTRIBUTE
              ? { position: 0, names: ['attribute'] }
              : undefined;
        node = signature && phpArgument(args, signature.position, signature.names);
      }
      const reference = node && literalReference(language, node);
      if (reference) {
        references.push(reference);
      }
    }
    return references;
  }
}

/** The argument at `position` or named one of `names`; undefined after an argument unpacking. */
function phpArgument(args: Node, position: number, names: readonly string[]): Node | undefined {
  let index = 0;
  for (const argument of args.namedChildren) {
    if (argument?.type !== 'argument') {
      continue;
    }
    if (argument.namedChildren.some((child) => child?.type === 'variadic_unpacking')) {
      return undefined;
    }
    const name = argument.childForFieldName('name');
    const value = argument.namedChildren[argument.namedChildren.length - 1];
    if (name ? names.includes(name.text) : index++ === position) {
      return value && value !== name ? value : undefined;
    }
  }
  return undefined;
}

function literalReference(language: DocumentLanguage, node: Node): RoleReference | null {
  const name = language === 'php' ? phpStringLiteralValue(node) : twigStringLiteralValue(node);
  if (name === null) {
    return null;
  }
  return {
    name,
    start: node.startIndex,
    end: node.endIndex,
    nameStart: node.startIndex + 1,
    nameEnd: node.endIndex - 1,
    declaration: false,
    attributes: true,
  };
}
