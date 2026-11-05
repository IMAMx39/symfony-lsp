import * as fs from 'node:fs';
import * as path from 'node:path';
import { MAIN_NAMESPACE } from '../project/TwigLoaderPaths';
import { isInsidePath, isSamePath } from '../util/paths';

export interface IndexedTemplate {
  /** Name as written in code: `dir/file.html.twig` or `@Namespace/dir/file.html.twig`. */
  name: string;
  namespace: string;
  file: string;
}

/** Safety net against pathological directories (e.g. a namespace pointing at the disk root). */
const MAX_FILES_PER_NAMESPACE = 20_000;

/**
 * The `.twig` templates reachable in each namespace. When several directories of a namespace
 * hold the same name, the first one wins (Twig's lookup order) and the others are hidden.
 *
 * Subdirectories that are themselves registered for another namespace (e.g. the bundle
 * overrides in templates/bundles/) are not listed under the parent namespace: they are
 * offered under their own namespace instead.
 */
export class TemplateIndex {
  private readonly byNamespace = new Map<string, IndexedTemplate[]>();
  private readonly allRoots: readonly string[];

  constructor(private readonly namespaces: ReadonlyMap<string, readonly string[]>) {
    this.allRoots = [...new Set([...namespaces.values()].flat())];
    for (const namespace of namespaces.keys()) {
      this.scan(namespace);
    }
  }

  templates(): IndexedTemplate[] {
    return [...this.byNamespace.values()].flat();
  }

  /** Rescans the namespaces whose directories contain `file`. Returns true if any was rescanned. */
  refresh(file: string): boolean {
    let rescanned = false;
    for (const [namespace, roots] of this.namespaces) {
      if (roots.some((root) => isInsidePath(file, root))) {
        this.scan(namespace);
        rescanned = true;
      }
    }
    return rescanned;
  }

  private scan(namespace: string): void {
    const seen = new Set<string>();
    const templates: IndexedTemplate[] = [];
    for (const root of this.namespaces.get(namespace) ?? []) {
      for (const file of this.listTwigFiles(root)) {
        const relative = path.relative(root, file).split(path.sep).join('/');
        const name = namespace === MAIN_NAMESPACE ? relative : `@${namespace}/${relative}`;
        if (!seen.has(name) && templates.length < MAX_FILES_PER_NAMESPACE) {
          seen.add(name);
          templates.push({ name, namespace, file });
        }
      }
    }
    this.byNamespace.set(namespace, templates);
  }

  private listTwigFiles(root: string): string[] {
    const files: string[] = [];
    const pending = [root];
    while (pending.length > 0 && files.length < MAX_FILES_PER_NAMESPACE) {
      const dir = pending.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!this.allRoots.some((other) => isSamePath(other, full))) {
            pending.push(full);
          }
        } else if (entry.isFile() && entry.name.endsWith('.twig')) {
          files.push(full);
        }
      }
    }
    return files.sort();
  }
}
