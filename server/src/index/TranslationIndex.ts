import * as fs from 'node:fs';
import * as path from 'node:path';
import { Location, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TranslatorConfig } from '../project/TranslatorConfig';
import { parseTranslationFile, parseTranslationFileName, type TranslationMessage } from '../translations/translationFiles';
import { isInsidePath, pathKey, pathToUri } from '../util/paths';

/** Environment whose configuration is mirrored. */
export const TRANSLATIONS_ENV = 'dev';

/** A message of a domain in one locale. */
export interface TranslationEntry {
  key: string;
  value: string;
  locale: string;
  location: Location;
}

/** A key of a domain, with its value in the default locale (null when it has none there). */
export interface TranslationKey {
  key: string;
  value: string | null;
}

interface IndexedFile {
  file: string;
  domain: string;
  locale: string;
  /** Index of the scanned directory: a higher one overrides a lower one. */
  priority: number;
  messages: TranslationMessage[];
  uri: string;
  text: TextDocument;
}

/**
 * Translation messages of the project directories FrameworkBundle scans (translator.paths, then
 * default_path, recursively), read from the YAML and XLIFF files named `domain.locale.format`.
 * Open documents can override their file (updateFile). Bundle and component translations are
 * not read.
 */
export class TranslationIndex {
  private config: TranslatorConfig;
  private readonly files = new Map<string, IndexedFile>();

  constructor(private readonly projectRoot: string) {
    this.config = TranslatorConfig.load(projectRoot, TRANSLATIONS_ENV);
    this.scan();
  }

  get defaultLocale(): string {
    return this.config.defaultLocale;
  }

  get warnings(): readonly string[] {
    return this.config.warnings;
  }

  /** Number of messages indexed, every domain and locale included. */
  size(): number {
    return [...this.files.values()].reduce((total, file) => total + file.messages.length, 0);
  }

  /**
   * Every definition of a key: the default locale first, then the other locales by name; within
   * a locale, the definition that wins (highest directory, then last file by name) first.
   */
  entries(domain: string, key: string): TranslationEntry[] {
    const entries: Array<TranslationEntry & { order: [number, string] }> = [];
    for (const indexed of this.files.values()) {
      if (indexed.domain !== domain) {
        continue;
      }
      for (const message of indexed.messages) {
        if (message.key === key) {
          entries.push({
            key,
            value: message.value,
            locale: indexed.locale,
            location: Location.create(indexed.uri, Range.create(indexed.text.positionAt(message.start), indexed.text.positionAt(message.end))),
            order: [indexed.priority, indexed.file],
          });
        }
      }
    }
    const localeRank = (locale: string): string => (locale === this.defaultLocale ? '' : locale);
    entries.sort(
      (a, b) =>
        localeRank(a.locale).localeCompare(localeRank(b.locale)) ||
        compareOrder(b.order, a.order),
    );
    return entries.map(({ order: _order, ...entry }) => entry);
  }

  /** Keys of a domain in every locale, with the winning value of the default locale. */
  keys(domain: string): TranslationKey[] {
    const keys = new Map<string, { value: string | null; order: [number, string] | null }>();
    for (const indexed of this.files.values()) {
      if (indexed.domain !== domain) {
        continue;
      }
      const isDefault = indexed.locale === this.defaultLocale;
      const order: [number, string] = [indexed.priority, indexed.file];
      for (const message of indexed.messages) {
        const known = keys.get(message.key);
        if (known === undefined) {
          keys.set(message.key, isDefault ? { value: message.value, order } : { value: null, order: null });
        } else if (isDefault && (known.order === null || compareOrder(order, known.order) >= 0)) {
          keys.set(message.key, { value: message.value, order });
        }
      }
    }
    return [...keys].map(([key, { value }]) => ({ key, value }));
  }

  /** Configuration changed (config/packages): directories and default locale may differ. */
  reloadConfig(): void {
    this.config = TranslatorConfig.load(this.projectRoot, TRANSLATIONS_ENV);
    this.files.clear();
    this.scan();
  }

  /** True when the file is a translation resource read by this index. */
  isTranslationFile(file: string): boolean {
    return this.describe(file) !== null;
  }

  /**
   * Re-reads a translation file, from `content` (open document) or from disk when null.
   * Invalid content keeps the previous messages (file being edited).
   * Returns true when the file is a translation file of the project.
   */
  updateFile(file: string, content: string | null): boolean {
    const described = this.describe(file);
    if (described === null) {
      return false;
    }
    const key = pathKey(file);
    const source = content ?? readText(file);
    if (source === null) {
      this.files.delete(key);
      return true;
    }
    const messages = parseTranslationFile(source, described.format);
    if (messages !== null) {
      const uri = pathToUri(file);
      this.files.set(key, { ...described, file, messages, uri, text: TextDocument.create(uri, described.format, 0, source) });
    }
    return true;
  }

  private describe(file: string): { domain: string; locale: string; format: 'yaml' | 'xliff'; priority: number } | null {
    const name = parseTranslationFileName(path.basename(file));
    if (name === null || name.format === null) {
      return null;
    }
    let priority = -1;
    this.config.dirs.forEach((dir, index) => {
      if (isInsidePath(file, dir)) {
        priority = index;
      }
    });
    return priority === -1 ? null : { domain: name.domain, locale: name.locale, format: name.format, priority };
  }

  private scan(): void {
    for (const dir of this.config.dirs) {
      for (const file of listFiles(dir)) {
        this.updateFile(file, null);
      }
    }
  }
}

function compareOrder(a: [number, string], b: [number, string]): number {
  return a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
}

/** Files under a directory, recursively (Finder follows links, like FrameworkExtension). */
function listFiles(dir: string): string[] {
  const files: string[] = [];
  const pending = [dir];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    const real = realPath(current);
    if (visited.has(real)) {
      continue;
    }
    visited.add(real);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(full))) {
        pending.push(full);
      } else {
        files.push(full);
      }
    }
  }
  return files;
}

function realPath(dir: string): string {
  try {
    return pathKey(fs.realpathSync(dir));
  } catch {
    return pathKey(dir);
  }
}

function isDirectory(file: string): boolean {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
