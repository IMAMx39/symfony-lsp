import type { Location } from 'vscode-languageserver';

export interface ServiceInfo {
  id: string;
  /** Class of the service (without leading `\`), null when unknown or for an alias. */
  class: string | null;
  /** Target id when the service is an alias. */
  alias: string | null;
  /** Where the service is declared (YAML key), null when only known from the container. */
  location: Location | null;
}
