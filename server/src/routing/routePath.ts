/**
 * Route variables, as RouteCompiler::VARIABLE_REGEX parses them, plus the Symfony 7.1
 * mapping syntax: `{name}`, `{!name}`, `{name<\d+>}`, `{name?default}`, `{name:entity.field}`.
 */
const VARIABLE = /\{!?([A-Za-z_\u0080-￿][\w\u0080-￿]*)(?::[\w.\u0080-￿]*)?(?:<[^>]*>)?(?:\?[^}]*)?\}/g;

/** Variable names of a route path, in order of appearance, without duplicates. */
export function pathVariables(path: string): string[] {
  return [...new Set([...path.matchAll(VARIABLE)].map((match) => match[1] ?? ''))].filter((name) => name !== '');
}

/** Path with inline requirements, defaults and mappings stripped: `/blog/{slug}`. */
export function displayPath(path: string): string {
  return path.replace(VARIABLE, (_match, name: string) => `{${name}}`);
}

/** Route::setPath(): exactly one leading slash. */
export function normalizeRoutePath(path: string): string {
  return `/${path.trim().replace(/^\/+/, '')}`;
}

/** RouteCollection::addPrefix(): `/prefix` + path, the prefix trimmed of slashes. */
export function addPathPrefix(prefix: string, path: string): string {
  const trimmed = prefix.trim().replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? path : `/${trimmed}${path}`;
}

/**
 * Rebuilds a path from the tokens of a compiled generator route. Tokens are stored in
 * reverse order: `['text', '/blog']` or `['variable', '/', regex, 'slug', important]`.
 */
export function pathFromTokens(tokens: unknown): string | null {
  if (!Array.isArray(tokens)) {
    return null;
  }
  let path = '';
  for (const token of [...tokens].reverse()) {
    if (!Array.isArray(token)) {
      return null;
    }
    const [type, first, , name] = token;
    if (type === 'text' && typeof first === 'string') {
      path += first;
    } else if (type === 'variable' && typeof first === 'string' && typeof name === 'string') {
      path += `${first}{${name}}`;
    } else {
      return null;
    }
  }
  return path === '' ? '/' : path;
}
