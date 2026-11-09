import type { Location, Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { MessageHandlerIndex } from '../../index/MessageHandlerIndex';
import type { OpenText } from '../../project/classSource';
import type { ClassNameReference } from './MessageClassReferenceFinder';

/**
 * Handlers of the message class under the cursor (the name, or right after it). Null when the
 * class has none, so that other servers answer alone.
 */
export function provideMessageHandlerImplementation(
  document: TextDocument,
  position: Position,
  references: readonly ClassNameReference[],
  index: MessageHandlerIndex,
  openText?: OpenText,
): Location[] | null {
  const offset = document.offsetAt(position);
  const reference = references.find((candidate) => offset >= candidate.start && offset <= candidate.end);
  if (!reference) {
    return null;
  }
  const handlers = index.handlersOf(reference.className, openText);
  return handlers.length > 0 ? handlers.map((handler) => handler.location) : null;
}
