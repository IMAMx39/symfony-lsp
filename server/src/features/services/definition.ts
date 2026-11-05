import type { Location, Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ServiceIndex } from '../../index/ServiceIndex';
import type { ServiceReference } from '../../services/yamlServices';

/** YAML declaration of the referenced service, else its class (aliases followed). */
export function provideServiceDefinition(
  document: TextDocument,
  position: Position,
  references: readonly ServiceReference[],
  index: ServiceIndex,
): Location | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset >= candidate.start && offset < candidate.end);
  const service = reference && index.get(reference.id);
  return service ? index.locationOf(service) : null;
}
