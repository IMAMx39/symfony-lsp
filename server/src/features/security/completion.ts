import { CompletionItemKind, Range, TextEdit, type CompletionItem, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { DoctrineEntities, OpenText } from '../../doctrine/DoctrineEntities';
import type { ProviderDeclaration, NameReference, SecurityReferences } from '../../security/securityYaml';
import { providerKey } from '../../security/securityYaml';

/** User provider names for a cursor on a provider reference. Replaces the whole name. */
export function provideSecurityProviderCompletion(
  document: TextDocument,
  position: Position,
  references: SecurityReferences,
  providers: readonly ProviderDeclaration[],
): CompletionItem[] | null {
  const reference = nameAt(references.providers, document.offsetAt(position));
  if (reference === undefined) {
    return null;
  }
  const range = Range.create(document.positionAt(reference.nameStart), document.positionAt(reference.nameEnd));
  const seen = new Set<string>();
  return providers
    .filter((provider) => !seen.has(providerKey(provider.name)) && seen.add(providerKey(provider.name)))
    .map((provider) => ({
      label: provider.name,
      kind: CompletionItemKind.Reference,
      detail: providerDetail(provider),
      filterText: provider.name,
      textEdit: TextEdit.replace(range, provider.name),
    }));
}

/**
 * Mapped fields of the entity for a cursor on `property:` of an entity provider (the user is
 * loaded with `findOneBy([property => identifier])`): columns only, not associations.
 */
export function provideEntityPropertyCompletion(
  document: TextDocument,
  position: Position,
  references: SecurityReferences,
  doctrine: DoctrineEntities,
  openText: OpenText,
): CompletionItem[] | null {
  const reference = nameAt(references.entityProperties, document.offsetAt(position));
  const fields = reference && doctrine.fields(reference.entityClass, openText);
  if (!reference || !fields) {
    return null;
  }
  const range = Range.create(document.positionAt(reference.nameStart), document.positionAt(reference.nameEnd));
  return fields
    .filter((field) => field.kind === 'field')
    .map((field) => ({
      label: field.name,
      kind: CompletionItemKind.Field,
      detail: field.phpType ?? undefined,
      filterText: field.name,
      textEdit: TextEdit.replace(range, field.name),
    }));
}

function providerDetail(provider: ProviderDeclaration): string | undefined {
  if (provider.entityClass !== null) {
    return `entity: ${provider.entityClass}`;
  }
  if (provider.serviceId !== null) {
    return `id: ${provider.serviceId}`;
  }
  return provider.type ?? undefined;
}

function nameAt<T extends NameReference>(references: readonly T[], offset: number): T | undefined {
  return references.find((candidate) => offset >= candidate.nameStart && offset <= candidate.nameEnd);
}
