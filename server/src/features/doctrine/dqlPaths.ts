import type { DoctrineEntities, EntityField, OpenText } from '../../doctrine/DoctrineEntities';
import type { AliasSource } from './QueryBuilderReferenceFinder';

const MAX_DEPTH = 8;

/**
 * Identifier paths of DQL text (`t`, `t.project`, `p.address.city`), not part of a parameter
 * (`:id`, `?1`), a class name (`App\Entity\Task`) or a PHP variable.
 */
const DQL_PATH = /(?<![\w.:?\\$])[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/g;

/** A segment of a DQL path, offsets absolute in the document. */
export interface DqlSegment {
  name: string;
  start: number;
  end: number;
}

/** A DQL path: the alias then the field segments. */
export interface DqlPath {
  segments: DqlSegment[];
}

/** Paths of the DQL text `content`, which starts at `contentStart` in the document. */
export function dqlPaths(content: string, contentStart: number): DqlPath[] {
  const paths: DqlPath[] = [];
  for (const match of content.matchAll(DQL_PATH)) {
    let offset = contentStart + match.index;
    const segments = match[0].split('.').map((name) => {
      const segment = { name, start: offset, end: offset + name.length };
      offset = segment.end + 1;
      return segment;
    });
    paths.push({ segments });
  }
  return paths;
}

/** The path and segment index under `offset` (segment end included, for a cursor right after a name). */
export function dqlPathAt(content: string, contentStart: number, offset: number): { path: DqlPath; index: number } | null {
  for (const path of dqlPaths(content, contentStart)) {
    const index = path.segments.findIndex((segment) => offset >= segment.start && offset <= segment.end);
    if (index !== -1) {
      return { path, index };
    }
  }
  return null;
}

/** Entity class behind an alias; null for an unknown or ambiguous alias. */
export function resolveAlias(
  alias: string,
  aliases: ReadonlyMap<string, AliasSource | null>,
  doctrine: DoctrineEntities,
  openText: OpenText | undefined,
  depth = 0,
): string | null {
  const source = aliases.get(alias);
  if (!source || depth > MAX_DEPTH) {
    return null;
  }
  switch (source.kind) {
    case 'entity':
      return source.className;
    case 'repository':
      return doctrine.entityOfRepository(source.repositoryClass, openText);
    case 'join': {
      const parent = resolveAlias(source.alias, aliases, doctrine, openText, depth + 1);
      const association = parent === null ? undefined : doctrine.fields(parent, openText)?.find((field) => field.name === source.association);
      return association?.kind === 'association' ? association.target : null;
    }
  }
}

/**
 * Field named by the segment `index` (≥ 1) of a path: segments before it must be embedded objects
 * (DQL does not navigate through associations). Null when anything is unknown.
 */
export function resolveDqlField(
  path: DqlPath,
  index: number,
  aliases: ReadonlyMap<string, AliasSource | null>,
  doctrine: DoctrineEntities,
  openText: OpenText | undefined,
): EntityField | null {
  const [alias] = path.segments;
  let className = alias && index >= 1 ? resolveAlias(alias.name, aliases, doctrine, openText) : null;
  for (let position = 1; position <= index && className !== null; position++) {
    const segment = path.segments[position];
    const field = segment && doctrine.fields(className, openText)?.find((candidate) => candidate.name === segment.name);
    if (!field) {
      return null;
    }
    if (position === index) {
      return field;
    }
    className = field.kind === 'embedded' ? field.target : null;
  }
  return null;
}
