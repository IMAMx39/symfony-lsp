import { CompletionItemKind, Range, TextEdit, type CompletionItem, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { DoctrineEntities, OpenText } from '../../doctrine/DoctrineEntities';
import type { SecurityConfig } from '../../project/SecurityConfig';
import type { NameReference, ProviderDeclaration, RoleReference, SecurityReferences } from '../../security/securityYaml';
import { providerKey, SECURITY_ATTRIBUTES } from '../../security/securityYaml';

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

/**
 * Role names for a cursor on a role (not a `role_hierarchy` key): every role of the security
 * configuration, plus the AuthenticatedVoter attributes where they are checked through isGranted().
 * Replaces the whole name.
 */
export function provideRoleCompletion(
  document: TextDocument,
  position: Position,
  references: readonly RoleReference[],
  config: SecurityConfig,
): CompletionItem[] | null {
  const reference = nameAt(references, document.offsetAt(position));
  if (reference === undefined || reference.declaration) {
    return null;
  }
  const range = Range.create(document.positionAt(reference.nameStart), document.positionAt(reference.nameEnd));
  const hierarchy = config.roleHierarchy();
  const attributes = reference.attributes ? SECURITY_ATTRIBUTES : [];
  const attributeNames = new Set(attributes.map((attribute) => attribute.name));
  const roles = config.roles().filter((role) => !attributeNames.has(role));
  return [
    ...roles.map((role) => {
      const reachable = config.reachableRoles(role, hierarchy);
      return {
        label: role,
        kind: CompletionItemKind.Constant,
        detail: reachable.length > 0 ? `includes ${reachable.join(', ')}` : undefined,
        sortText: `0${role}`,
        filterText: role,
        textEdit: TextEdit.replace(range, role),
      };
    }),
    ...attributes.map((attribute) => ({
      label: attribute.name,
      kind: CompletionItemKind.Keyword,
      detail: attribute.description,
      sortText: `1${attribute.name}`,
      filterText: attribute.name,
      textEdit: TextEdit.replace(range, attribute.name),
    })),
  ];
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
