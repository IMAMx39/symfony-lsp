import type { Location, Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ServiceIndex } from '../../index/ServiceIndex';
import type { ClassReference, ServiceReference } from '../../services/yamlServices';
import type { ParameterReference } from './AutowireReferenceFinder';

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

/** YAML declaration of the referenced parameter (container-only parameters have none). */
export function provideParameterDefinition(
  document: TextDocument,
  position: Position,
  references: readonly ParameterReference[],
  index: ServiceIndex,
): Location | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => candidate.closed && offset >= candidate.start && offset < candidate.end);
  // `%env(NAME)%` is an environment variable, not a parameter.
  if (!reference || reference.name.startsWith('env(')) {
    return null;
  }
  return index.getParameter(reference.name)?.location ?? null;
}

/** Class named by a service key, a `class:` value or an `_instanceof` key. */
export function provideClassDefinition(
  document: TextDocument,
  position: Position,
  references: readonly ClassReference[],
  index: ServiceIndex,
): Location | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset >= candidate.start && offset < candidate.end);
  return reference ? index.classLocation(reference.className) : null;
}
