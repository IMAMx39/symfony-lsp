import type { Location, Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { DoctrineEntities, OpenText } from '../../doctrine/DoctrineEntities';
import type { ServiceIndex } from '../../index/ServiceIndex';
import type { SecurityConfig } from '../../project/SecurityConfig';
import type { NameReference, SecurityReferences } from '../../security/securityYaml';
import { provideClassDefinition, provideServiceDefinition } from '../services/definition';

/**
 * In a `security:` block: declaration of the referenced user provider, mapped field of an entity
 * provider's `property`, service (YAML declaration, else its class), or class through PSR-4.
 */
export function provideSecurityDefinition(
  document: TextDocument,
  position: Position,
  references: SecurityReferences,
  config: SecurityConfig,
  services: ServiceIndex,
  doctrine: DoctrineEntities,
  openText: OpenText,
): Location | null {
  const offset = document.offsetAt(position);
  const provider = referenceAt(references.providers, offset);
  if (provider) {
    return provider.name === '' ? null : (config.findProvider(provider.name)?.location ?? null);
  }
  const property = referenceAt(references.entityProperties, offset);
  if (property) {
    const field = doctrine.fields(property.entityClass, openText)?.find((candidate) => candidate.name === property.name);
    return field?.location ?? null;
  }
  return (
    provideServiceDefinition(document, position, references.services, services) ??
    provideClassDefinition(document, position, references.classes, services)
  );
}

function referenceAt<T extends NameReference>(references: readonly T[], offset: number): T | undefined {
  return references.find((candidate) => offset >= candidate.start && offset < candidate.end);
}
