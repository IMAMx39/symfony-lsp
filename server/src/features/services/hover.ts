import { MarkupKind, Range, type Hover, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ServiceIndex } from '../../index/ServiceIndex';
import type { ServiceReference } from '../../services/yamlServices';
import { displayFilePath, uriToPath } from '../../util/paths';

/**
 * Markdown summary of the referenced service: alias target, class, tags, other aliases of the
 * same service, and where it is declared.
 */
export function provideServiceHover(
  document: TextDocument,
  position: Position,
  references: readonly ServiceReference[],
  index: ServiceIndex,
  projectRoot: string,
): Hover | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset >= candidate.start && offset < candidate.end);
  const service = reference && index.get(reference.id);
  if (!reference || !service) {
    return null;
  }
  const target = index.resolve(service);

  const code = (text: string): string => `\`${text}\``;
  const sections = [service.alias === null ? `**${service.id}**` : `**${service.id}** → alias of **${target?.id ?? service.alias}**`];
  if (target?.class) {
    sections.push(`Class: ${code(target.class)}`);
  }
  if (target && target.tags.length > 0) {
    sections.push(`Tags: ${target.tags.map(code).join(', ')}`);
  }
  const aliases = target ? index.aliasesOf(target.id).filter((alias) => alias.id !== service.id) : [];
  if (aliases.length > 0) {
    sections.push(`Aliases: ${aliases.map((alias) => code(alias.id)).join(', ')}`);
  }
  const location = index.locationOf(service);
  if (location) {
    sections.push(`Defined in ${code(`${displayFilePath(uriToPath(location.uri), projectRoot)}:${location.range.start.line + 1}`)}`);
  }

  return {
    contents: { kind: MarkupKind.Markdown, value: sections.join('\n\n') },
    range: Range.create(document.positionAt(reference.start), document.positionAt(reference.end)),
  };
}
