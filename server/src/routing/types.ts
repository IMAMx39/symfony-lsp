import type { Location } from 'vscode-languageserver';

export interface RouteInfo {
  name: string;
  /** Path pattern (e.g. `/blog/{slug}`), null when unknown. */
  path: string | null;
  /** Allowed HTTP methods ([] = any), null when unknown. */
  methods: readonly string[] | null;
  /** `_controller` default (`App\Controller\X::y`, a class for invokables, or a service id). */
  controller: string | null;
  /** Where the route is declared (attribute, YAML key), null when only known from the cache. */
  location: Location | null;
  /** Other names that point to this route (Symfony route aliases). */
  aliases: readonly string[];
}

/** Routes extracted from one source. `complete` is false when some routes could not be read. */
export interface RouteExtraction {
  routes: RouteInfo[];
  complete: boolean;
}

/** A YAML import of attribute routes from a directory or file, with its prefixes. */
export interface RouteImport {
  /** Absolute directory or file. */
  target: string;
  prefix: string;
  namePrefix: string;
}
