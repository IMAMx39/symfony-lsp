import { MarkupKind, Range, type Hover, type Location, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { SecurityConfig } from '../../project/SecurityConfig';
import { SECURITY_ATTRIBUTES, type RoleReference } from '../../security/securityYaml';
import { displayFilePath, uriToPath } from '../../util/paths';

/**
 * Markdown summary of the role under the cursor: what an AuthenticatedVoter attribute means, or
 * the roles it includes and is included in through `role_hierarchy`, and where it is declared.
 * Null for a role the hierarchy says nothing about.
 */
export function provideRoleHover(
  document: TextDocument,
  position: Position,
  references: readonly RoleReference[],
  config: SecurityConfig,
  projectRoot: string,
): Hover | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset >= candidate.start && offset < candidate.end);
  if (!reference || reference.name === '') {
    return null;
  }
  const code = (text: string): string => `\`${text}\``;
  const sections = [`**${reference.name}**`];
  const attribute = SECURITY_ATTRIBUTES.find((candidate) => candidate.name === reference.name);
  if (attribute) {
    sections.push(`${attribute.description} (AuthenticatedVoter attribute).`);
  } else {
    const hierarchy = config.roleHierarchy();
    const includes = config.reachableRoles(reference.name, hierarchy);
    const includedIn = config.rolesIncluding(reference.name);
    if (includes.length > 0) {
      sections.push(`Includes: ${includes.map(code).join(', ')}`);
    }
    if (includedIn.length > 0) {
      sections.push(`Included in: ${includedIn.map(code).join(', ')}`);
    }
    const location = hierarchy.get(reference.name)?.location;
    if (location) {
      sections.push(`Defined in ${code(formatLocation(location, projectRoot))}`);
    }
    if (sections.length === 1) {
      return null;
    }
  }
  return {
    contents: { kind: MarkupKind.Markdown, value: sections.join('\n\n') },
    range: Range.create(document.positionAt(reference.start), document.positionAt(reference.end)),
  };
}

function formatLocation(location: Location, projectRoot: string): string {
  return `${displayFilePath(uriToPath(location.uri), projectRoot)}:${location.range.start.line + 1}`;
}
