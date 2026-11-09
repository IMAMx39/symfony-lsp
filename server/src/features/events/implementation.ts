import type { Location, Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { EventListenerIndex } from '../../index/EventListenerIndex';
import type { OpenText } from '../../project/classSource';
import type { ClassNameReference } from '../messenger/MessageClassReferenceFinder';
import type { EventNameReference } from './EventNameReferenceFinder';

/**
 * Listeners of the event under the cursor (the name, or right after it): an event name
 * (constant or literal in an event position) or an event class. Null when the event has none,
 * so that other servers answer alone.
 */
export function provideEventListenerImplementation(
  document: TextDocument,
  position: Position,
  classes: readonly ClassNameReference[],
  names: readonly EventNameReference[],
  index: EventListenerIndex,
  openText?: OpenText,
): Location[] | null {
  const offset = document.offsetAt(position);
  const covers = (reference: { start: number; end: number }) => offset >= reference.start && offset <= reference.end;
  const name = names.find(covers);
  const eventClass = name ? undefined : classes.find(covers);
  const event = name
    ? 'name' in name.event
      ? name.event.name
      : index.constantValue(name.event.className, name.event.constant, openText)
    : (eventClass?.className ?? null);
  if (event === null || event === '') {
    return null;
  }
  const listeners = index.listenersOf(event, openText);
  return listeners.length > 0 ? listeners.map((listener) => listener.location) : null;
}
