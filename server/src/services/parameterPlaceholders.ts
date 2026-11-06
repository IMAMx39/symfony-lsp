/**
 * A parameter name in a document. `start`/`end` cover the `%name%` placeholder, or the whole
 * literal for `param: 'name'`; `nameStart`/`nameEnd` the name alone. `closed` is false for a
 * trailing `%name` being typed (completion then adds the closing `%`).
 */
export interface ParameterReference {
  name: string;
  start: number;
  end: number;
  nameStart: number;
  nameEnd: number;
  closed: boolean;
}

/**
 * A `%name%` placeholder of a string value. Offsets are relative to the value: `start` is the
 * opening `%`, `nameStart`/`nameEnd` the name alone. `closed` is false for a trailing `%name`
 * being typed.
 */
export interface Placeholder {
  name: string;
  start: number;
  nameStart: number;
  nameEnd: number;
  closed: boolean;
}

/**
 * Placeholders resolved by ParameterBag::resolveString(): `%name%` where the name contains
 * neither `%` nor whitespace; `%%` is an escaped `%`.
 */
export function findPlaceholders(value: string): Placeholder[] {
  const placeholders: Placeholder[] = [];
  let index = 0;
  while (index < value.length) {
    if (value[index] !== '%') {
      index++;
      continue;
    }
    if (value[index + 1] === '%') {
      index += 2;
      continue;
    }
    const close = value.indexOf('%', index + 1);
    const name = value.slice(index + 1, close === -1 ? value.length : close);
    if (/\s/.test(name)) {
      index++;
      continue;
    }
    placeholders.push({ name, start: index, nameStart: index + 1, nameEnd: index + 1 + name.length, closed: close !== -1 });
    if (close === -1) {
      break;
    }
    index = close + 1;
  }
  return placeholders;
}
