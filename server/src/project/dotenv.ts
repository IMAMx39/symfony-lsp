/** A variable defined in a .env file. */
export interface DotenvVariable {
  name: string;
  /** Value as written, without its quotes (no interpolation nor command expansion). */
  value: string;
  /** 0-based line of the definition. */
  line: number;
}

/** Dotenv::VARNAME_REGEX. */
const DEFINITION = /^\s*(?:export\s+)?(_?[A-Za-z][A-Za-z0-9_]*)=(.*)$/;

/**
 * Variables of a .env file, in order (a later definition of a name wins). Follows the syntax of
 * Symfony Dotenv closely enough to list names: comments, `export`, quoted values (which may span
 * several lines) and unquoted values ending at ` #`.
 */
export function parseDotenv(source: string): DotenvVariable[] {
  const variables: DotenvVariable[] = [];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const match = DEFINITION.exec(lines[index] ?? '');
    const [, name, rest] = match ?? [];
    if (name === undefined || rest === undefined) {
      continue;
    }
    const quote = rest[0];
    if (quote !== "'" && quote !== '"') {
      variables.push({ name, value: rest.replace(/\s+#.*$/, '').trim(), line: index });
      continue;
    }
    // Quoted value: up to the closing quote, possibly on a following line.
    let value = rest.slice(1);
    let end = closingQuote(value, quote);
    const start = index;
    while (end === -1 && index + 1 < lines.length) {
      index++;
      value += `\n${lines[index] ?? ''}`;
      end = closingQuote(value, quote);
    }
    variables.push({ name, value: end === -1 ? value : value.slice(0, end), line: start });
  }
  return variables;
}

/** Index of the closing quote; in double quotes, `\"` is escaped. */
function closingQuote(text: string, quote: string): number {
  for (let index = 0; index < text.length; index++) {
    if (quote === '"' && text[index] === '\\') {
      index++;
    } else if (text[index] === quote) {
      return index;
    }
  }
  return -1;
}
