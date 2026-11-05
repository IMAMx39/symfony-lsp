import { MarkupKind, Range, type Hover, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { RouteIndex } from '../../index/RouteIndex';
import { displayPath } from '../../routing/routePath';
import { displayFilePath, uriToPath } from '../../util/paths';
import { findRouteReferenceAt } from './definition';
import type { RouteReference } from './RouteReferenceFinder';

/**
 * Markdown summary of the route under the cursor:
 * methods and path, controller, and where it is declared.
 */
export function provideRouteHover(
  document: TextDocument,
  position: Position,
  references: readonly RouteReference[],
  index: RouteIndex,
  projectRoot: string,
): Hover | null {
  const reference = findRouteReferenceAt(references, document.offsetAt(position));
  const route = reference && index.get(reference.name);
  if (!reference || !route) {
    return null;
  }

  const sections = [route.name === reference.name ? `**${route.name}**` : `**${reference.name}** → alias of **${route.name}**`];
  const methods = route.methods === null ? null : route.methods.length === 0 ? 'ANY' : route.methods.join('|');
  const routePath = route.path === null ? null : displayPath(route.path);
  const signature = [methods, routePath].filter((part) => part !== null).join(' ');
  if (signature !== '') {
    sections.push(['```text', signature, '```'].join('\n'));
  }
  if (route.controller) {
    sections.push(`Controller: \`${route.controller}\``);
  }
  const location = index.locationOf(route);
  if (location) {
    sections.push(`Defined in \`${displayFilePath(uriToPath(location.uri), projectRoot)}:${location.range.start.line + 1}\``);
  }

  return {
    contents: { kind: MarkupKind.Markdown, value: sections.join('\n\n') },
    range: Range.create(document.positionAt(reference.start), document.positionAt(reference.end)),
  };
}
