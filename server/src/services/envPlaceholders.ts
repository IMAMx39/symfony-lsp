import type { Placeholder } from './parameterPlaceholders';

/** Processors of EnvVarProcessor::getProvidedTypes() (Symfony 7.4), with the type they return. */
export const ENV_PROCESSORS: ReadonlyMap<string, string> = new Map([
  ['base64', 'string'],
  ['bool', 'bool'],
  ['not', 'bool'],
  ['const', 'bool|int|float|string|array'],
  ['csv', 'array'],
  ['file', 'string'],
  ['float', 'float'],
  ['int', 'int'],
  ['json', 'array'],
  ['key', 'bool|int|float|string|array'],
  ['url', 'array'],
  ['query_string', 'array'],
  ['resolve', 'string'],
  ['default', 'bool|int|float|string|array'],
  ['string', 'string'],
  ['trim', 'string'],
  ['require', 'bool|int|float|string|array'],
  ['enum', 'BackedEnum'],
  ['shuffle', 'array'],
  ['defined', 'bool'],
  ['urlencode', 'string'],
]);

/** Processors whose next segment is an argument (`default:fallback_param:VAR`, `key:path:VAR`, `enum:Class:VAR`). */
const PROCESSORS_WITH_ARGUMENT = new Set(['default', 'key', 'enum']);

/**
 * The content of an env placeholder (`processor:...:NAME` inside `%env(...)%`, or the value of
 * `#[Autowire(env: '...')]`). Offsets are absolute and cover the content only.
 */
export interface EnvReference {
  start: number;
  end: number;
  /** How completion closes the placeholder after a variable name: `text` replaces up to `end`. */
  closing: { end: number; text: string };
}

/** The env reference of a `%env(...)%` placeholder found in a value starting at `valueStart`. */
export function envReferenceOf(placeholder: Placeholder, valueStart: number): EnvReference | null {
  if (!placeholder.name.startsWith('env(')) {
    return null;
  }
  const hasParenthesis = placeholder.name.endsWith(')');
  const end = valueStart + placeholder.nameEnd - (hasParenthesis ? 1 : 0);
  return {
    start: valueStart + placeholder.nameStart + 4,
    end,
    // `%env(NAME)%`: nothing to add; `%env(NAME)`: `)%` over the `)`; `%env(NAME`: `)%`.
    closing: hasParenthesis && placeholder.closed ? { end, text: '' } : { end: hasParenthesis ? end + 1 : end, text: ')%' },
  };
}

/** What may be typed in the segment under the cursor of an env reference. */
export interface EnvSegment {
  start: number;
  end: number;
  /** A variable name may go here (last segment). */
  variable: boolean;
  /** A processor may go here. */
  processor: boolean;
  /** Closing of the placeholder after a variable name (last segment only). */
  closing: EnvReference['closing'] | null;
}

/**
 * Segment of `processor:...:NAME` under the cursor: the last one is the variable (or, when the
 * chain so far is made of processors, a processor being typed); the others are processors,
 * except the argument following `default`, `key` or `enum`, which is never completed.
 */
export function envSegmentAt(text: string, reference: EnvReference, offset: number): EnvSegment | null {
  if (offset < reference.start || offset > reference.end) {
    return null;
  }
  const content = text.slice(reference.start, reference.end);
  const segments = content.split(':');
  let position = reference.start;
  let expectsArgument = false;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index] ?? '';
    const start = position;
    const end = start + segment.length;
    const last = index === segments.length - 1;
    if (offset <= end) {
      if (expectsArgument) {
        return null;
      }
      return { start, end, variable: last, processor: true, closing: last ? reference.closing : null };
    }
    expectsArgument = !expectsArgument && PROCESSORS_WITH_ARGUMENT.has(segment);
    position = end + 1;
  }
  return null;
}
