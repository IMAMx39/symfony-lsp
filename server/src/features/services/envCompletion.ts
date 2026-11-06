import { CompletionItemKind, Range, TextEdit, type CompletionItem, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { EnvVariable } from '../../index/EnvIndex';
import { ENV_PROCESSORS, envSegmentAt, type EnvReference } from '../../services/envPlaceholders';
import type { ParameterInfo } from '../../services/types';

/**
 * Inside `%env(...)%` (or `#[Autowire(env: '...')]`): variable names of the .env files and of the
 * `env(NAME)` default parameters on the last segment, processors (`int:`, `json:`…) on the
 * segments before it and while the first ones are being typed. Replaces the segment.
 */
export function provideEnvCompletion(
  document: TextDocument,
  position: Position,
  references: readonly EnvReference[],
  variables: readonly EnvVariable[],
  parameters: readonly ParameterInfo[],
): CompletionItem[] | null {
  const offset = document.offsetAt(position);
  const text = document.getText();
  const segment = references.map((reference) => envSegmentAt(text, reference, offset)).find((candidate) => candidate !== null);
  if (!segment) {
    return null;
  }
  const range = Range.create(document.positionAt(segment.start), document.positionAt(segment.end));
  const items: CompletionItem[] = [];
  if (segment.variable) {
    const closing = segment.closing ?? { end: segment.end, text: '' };
    const variableRange = Range.create(document.positionAt(segment.start), document.positionAt(closing.end));
    const names = new Map<string, string | undefined>(variables.map((variable) => [variable.name, variable.value]));
    for (const parameter of parameters) {
      const name = /^env\((\w+)\)$/.exec(parameter.name)?.[1];
      if (name !== undefined && !names.has(name)) {
        names.set(name, parameter.value ?? undefined);
      }
    }
    for (const [name, value] of names) {
      items.push({
        label: name,
        kind: CompletionItemKind.Variable,
        detail: value,
        sortText: `0${name}`,
        filterText: name,
        textEdit: TextEdit.replace(variableRange, `${name}${closing.text}`),
      });
    }
  }
  if (segment.processor) {
    for (const [processor, type] of ENV_PROCESSORS) {
      items.push({
        label: `${processor}:`,
        kind: CompletionItemKind.Function,
        detail: type,
        sortText: `1${processor}`,
        filterText: processor,
        // A segment before the last one is already followed by `:`.
        textEdit: TextEdit.replace(range, segment.variable ? `${processor}:` : processor),
      });
    }
  }
  return items;
}
