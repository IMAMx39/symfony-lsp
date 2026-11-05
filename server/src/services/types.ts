import type { Location } from 'vscode-languageserver';

export interface ServiceInfo {
  id: string;
  /** Class of the service (without leading `\`), null when unknown or for an alias. */
  class: string | null;
  /** Target id when the service is an alias. */
  alias: string | null;
  /** Tag names, without duplicates (a tag can be applied several times). */
  tags: readonly string[];
  /** Where the service is declared (YAML key), null when only known from the container. */
  location: Location | null;
}

export interface ParameterInfo {
  name: string;
  /** Value as text, null for collections or when not a scalar. */
  value: string | null;
  /** Where the parameter is declared (YAML key), null when only known from the container. */
  location: Location | null;
}
