import { XMLValidator } from 'fast-xml-parser';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

/** MessageCatalogueInterface::INTL_DOMAIN_SUFFIX: ICU messages share the domain of plain ones. */
const INTL_DOMAIN_SUFFIX = '+intl-icu';

/** Translator::assertValidLocale(). */
const VALID_LOCALE = /^[a-z0-9@_.-]+$/i;

/** Formats read here; FrameworkBundle loads others (php, json, csv, po…) that are not. */
export type TranslationFormat = 'yaml' | 'xliff';

export interface TranslationFileName {
  /** Domain without the `+intl-icu` suffix. */
  domain: string;
  locale: string;
  /** Null for a format that is not read. */
  format: TranslationFormat | null;
}

/** A message of a translation file. Offsets cover the key in the file. */
export interface TranslationMessage {
  key: string;
  value: string;
  start: number;
  end: number;
}

/**
 * `domain.locale.format`, split as FrameworkBundle's Translator does (the domain may contain
 * dots). Files with less than two dots are not translation resources (FrameworkExtension).
 */
export function parseTranslationFileName(basename: string): TranslationFileName | null {
  const parts = basename.split('.');
  if (parts.length < 3 || !/\.\w+$/.test(basename)) {
    return null;
  }
  const extension = parts.pop()!;
  const locale = parts.pop()!;
  const domain = parts.join('.');
  if (!VALID_LOCALE.test(locale)) {
    return null;
  }
  return {
    domain: domain.endsWith(INTL_DOMAIN_SUFFIX) ? domain.slice(0, -INTL_DOMAIN_SUFFIX.length) : domain,
    locale,
    format: formatOf(extension),
  };
}

function formatOf(extension: string): TranslationFormat | null {
  switch (extension) {
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'xlf':
    case 'xliff':
      return 'xliff';
    default:
      return null;
  }
}

/** Messages of a translation file, or null when it is not a valid resource. */
export function parseTranslationFile(source: string, format: TranslationFormat): TranslationMessage[] | null {
  return format === 'yaml' ? parseYamlMessages(source) : parseXliffMessages(source);
}

/** YamlFileLoader + ArrayLoader::flatten(): nested keys are joined with `.`, null values skipped. */
function parseYamlMessages(source: string): TranslationMessage[] | null {
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    return null;
  }
  const root = document.contents;
  if (root === null || (isScalar(root) && root.value === null)) {
    return [];
  }
  if (!isMap(root) && !isSeq(root)) {
    return null;
  }
  const messages: TranslationMessage[] = [];
  const visit = (collection: unknown, prefix: string): void => {
    if (isMap(collection)) {
      for (const pair of collection.items) {
        if (!isScalar(pair.key) || pair.key.value === null || pair.key.value === '<<' || !pair.key.range) {
          continue;
        }
        const key = prefix + String(pair.key.value);
        if (isMap(pair.value) || isSeq(pair.value)) {
          visit(pair.value, `${key}.`);
        } else if (isScalar(pair.value) && pair.value.value !== null) {
          messages.push({ key, value: String(pair.value.value), start: pair.key.range[0], end: pair.key.range[1] });
        }
      }
    }
    // Sequences get integer keys, but no key node to point at: their items are skipped.
  };
  visit(root, '');
  return messages;
}

/**
 * XliffFileLoader: XLIFF 1.2 `<trans-unit>` (key: `resname`, else `<source>`) and XLIFF 2.0
 * `<unit>`/`<segment>` (key: the unit's `name`, else `<source>`); the value is the target,
 * else the source. Units whose key holds markup (`<g>`, `<x/>`…) are skipped.
 */
function parseXliffMessages(source: string): TranslationMessage[] | null {
  if (XMLValidator.validate(source) !== true) {
    return null;
  }
  // Comments are blanked out (same length) so that offsets stay valid.
  const text = source.replace(/<!--[\s\S]*?-->/g, (comment) => ' '.repeat(comment.length));
  return text.includes('urn:oasis:names:tc:xliff:document:2.0') ? xliff2Messages(text) : xliff1Messages(text);
}

function xliff1Messages(text: string): TranslationMessage[] {
  const messages: TranslationMessage[] = [];
  for (const unit of elements(text, 'trans-unit', 0, text.length)) {
    const target = unit.body === null ? null : childText(text, 'target', unit.body);
    const sourceElement = unit.body === null ? null : childText(text, 'source', unit.body);
    const resname = attribute(text, 'resname', unit.attributes);
    const key = resname !== null && resname.value !== '' ? resname : sourceElement;
    if (key !== null && key.value !== null) {
      messages.push({ key: key.value, value: target?.value ?? sourceElement?.value ?? '', start: key.start, end: key.end });
    }
  }
  return messages;
}

function xliff2Messages(text: string): TranslationMessage[] {
  const messages: TranslationMessage[] = [];
  for (const unit of elements(text, 'unit', 0, text.length)) {
    if (unit.body === null) {
      continue;
    }
    const name = attribute(text, 'name', unit.attributes);
    for (const segment of elements(text, 'segment', unit.body.start, unit.body.end)) {
      const sourceElement = segment.body === null ? null : childText(text, 'source', segment.body);
      const target = segment.body === null ? null : childText(text, 'target', segment.body);
      const key = name ?? sourceElement;
      if (key !== null && key.value !== null) {
        messages.push({ key: key.value, value: target?.value ?? sourceElement?.value ?? '', start: key.start, end: key.end });
      }
    }
  }
  return messages;
}

interface Span {
  start: number;
  end: number;
}

interface Element {
  attributes: Span;
  /** Content between the tags, null for a self-closing element. */
  body: Span | null;
}

/** A decoded text value and the span of its raw text in the file. */
interface TextValue extends Span {
  /** Null when the text holds markup. */
  value: string | null;
}

/** Elements named `name` (any namespace prefix excluded) between two offsets, not nested. */
function elements(text: string, name: string, from: number, to: number): Element[] {
  const pattern = new RegExp(`<${name}(?=[\\s/>])([^>]*?)(/?)>`, 'g');
  const found: Element[] = [];
  pattern.lastIndex = from;
  for (let match = pattern.exec(text); match !== null && match.index < to; match = pattern.exec(text)) {
    const attributesStart = match.index + name.length + 1;
    const attributes = { start: attributesStart, end: attributesStart + (match[1]?.length ?? 0) };
    if (match[2] === '/') {
      found.push({ attributes, body: null });
      continue;
    }
    const bodyStart = match.index + match[0].length;
    const close = text.indexOf(`</${name}>`, bodyStart);
    if (close === -1 || close > to) {
      break;
    }
    found.push({ attributes, body: { start: bodyStart, end: close } });
    pattern.lastIndex = close + name.length + 3;
  }
  return found;
}

function childText(text: string, name: string, within: Span): TextValue | null {
  const [element] = elements(text, name, within.start, within.end);
  if (!element) {
    return null;
  }
  if (element.body === null) {
    return { value: '', start: element.attributes.end, end: element.attributes.end };
  }
  return { value: decodeText(text.slice(element.body.start, element.body.end)), ...element.body };
}

function attribute(text: string, name: string, within: Span): TextValue | null {
  const raw = text.slice(within.start, within.end);
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(raw);
  if (!match) {
    return null;
  }
  const value = match[1] ?? match[2] ?? '';
  const start = within.start + match.index + match[0].length - value.length - 1;
  return { value: decodeEntities(value), start, end: start + value.length };
}

/** Text content with CDATA sections and entities decoded, or null when it holds markup. */
function decodeText(raw: string): string | null {
  let value = '';
  for (const part of raw.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)) {
    if (part.startsWith('<![CDATA[')) {
      value += part.slice(9, -3);
    } else if (part.includes('<')) {
      return null;
    } else {
      value += decodeEntities(part);
    }
  }
  return value;
}

function decodeEntities(raw: string): string {
  return raw.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (entity, hex?: string, decimal?: string, named?: string) => {
    if (hex !== undefined) {
      return String.fromCodePoint(parseInt(hex, 16));
    }
    if (decimal !== undefined) {
      return String.fromCodePoint(parseInt(decimal, 10));
    }
    const names: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return names[named?.toLowerCase() ?? ''] ?? entity;
  });
}
