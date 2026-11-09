import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { listenerMethodName } from '../../../src/events/eventListeners';
import { EventNameReferenceFinder } from '../../../src/features/events/EventNameReferenceFinder';
import { provideEventListenerImplementation } from '../../../src/features/events/implementation';
import { MessageClassReferenceFinder } from '../../../src/features/messenger/MessageClassReferenceFinder';
import { EventListenerIndex } from '../../../src/index/EventListenerIndex';
import { ServiceIndex } from '../../../src/index/ServiceIndex';
import type { Parsers } from '../../../src/parsing/parsers';
import { isSamePath, pathToUri, uriToPath } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const PRELUDE =
  '<?php\nnamespace App\\Controller;\nuse App\\Event\\OrderEvents;\nuse App\\Event\\OrderPlacedEvent;\n' +
  'use Symfony\\Component\\EventDispatcher\\Attribute\\AsEventListener;\nuse Symfony\\Component\\HttpKernel\\KernelEvents;\n';

/** `ShortClass:line` (0-based line of the method name) of the fixture listeners. */
const KERNEL_REQUEST = ['OrderSubscriber:30', 'OrderListeners:14', 'LocaleListener:6', 'OrderListeners:37', 'OrderSubscriber:34'];
const ORDER_PLACED = ['OrderListeners:14', 'InvokableListener:10', 'OrderSubscriber:22'];
const ORDER_CANCELLED = ['OrderSubscriber:26', 'OrderListeners:33'];
const KERNEL_RESPONSE = ['OrderListeners:19', 'OrderSubscriber:38'];

describe('event listener implementation', () => {
  let parsers: Parsers;
  let classes: MessageClassReferenceFinder;
  let names: EventNameReferenceFinder;
  let index: EventListenerIndex;

  beforeAll(async () => {
    parsers = await loadParsers();
    classes = new MessageClassReferenceFinder(parsers);
    names = new EventNameReferenceFinder(parsers);
    index = new EventListenerIndex(fixtureApp, parsers, new ServiceIndex(fixtureApp, parsers));
  });

  function implementation(code: string, file = 'src/Controller/TestController.php', prelude = PRELUDE): string[] | null {
    const { document, offset } = withCursor(pathToUri(path.join(fixtureApp, file)), 'php', prelude + code);
    const tree = parsers.parse('php', document.getText())!;
    const classReferences = classes.find(tree.rootNode);
    const nameReferences = names.find(tree.rootNode);
    tree.delete();
    const locations = provideEventListenerImplementation(document, document.positionAt(offset), classReferences, nameReferences, index);
    return locations && locations.map((location) => `${path.basename(uriToPath(location.uri), '.php')}:${location.range.start.line}`);
  }

  it.each([
    ['new X()', `$dispatcher->dispatch(new OrderPlaced|Event());`],
    ['X::class', `$name = OrderPlacedEvent|::class;`],
    ['a type hint', `function f(OrderPlaced|Event $event) {}`],
    ['a constant holding the class', `$name = OrderEvents::PLA|CED;`],
  ])('lists the listeners of an event class from %s', (_label, code) => {
    expect(implementation(code)).toEqual(ORDER_PLACED);
  });

  it('lists the listeners from the declaration of the event', () => {
    const prelude = '<?php\n\nnamespace App\\Event;\n\n';
    expect(implementation('final class OrderPlaced|Event extends Event\n{\n}\n', 'src/Event/OrderPlacedEvent.php', prelude)).toEqual(ORDER_PLACED);
  });

  it('orders the listeners by priority, across sources and the compiled dispatcher, aliases applied', () => {
    expect(implementation(`$name = KernelEvents::REQUEST|;`)).toEqual(KERNEL_REQUEST);
    expect(implementation(`function f(\\Symfony\\Component\\HttpKernel\\Event\\Request|Event $event) {}`)).toEqual(KERNEL_REQUEST);
  });

  it.each([
    ['a constant', `$name = OrderEvents::CANCEL|LED;`, ORDER_CANCELLED],
    ['the second argument of dispatch()', `$dispatcher->dispatch($event, 'order.can|celled');`, ORDER_CANCELLED],
    ['a named eventName argument', `$dispatcher->dispatch(eventName: 'kernel.res|ponse', event: $event);`, KERNEL_RESPONSE],
    ['the event of an attribute', `class L {\n#[AsEventListener(event: 'kernel.res|ponse')]\npublic function f() {}\n}`, KERNEL_RESPONSE],
    ['a key of getSubscribedEvents()', `class S {\npublic static function getSubscribedEvents(): array { return ['kernel.res|ponse' => 'f']; }\n}`, KERNEL_RESPONSE],
  ])('lists the listeners of an event name from %s', (_label, code, expected) => {
    expect(implementation(code)).toEqual(expected);
  });

  it('lists the listeners of firewall dispatchers', () => {
    expect(implementation(`$name = \\Acme\\FooBundle\\Event\\Passport|Event::class;`)).toEqual(['LocaleListener:10']);
  });

  it('reads self::class in getSubscribedEvents()', () => {
    const prelude = '<?php\n\nnamespace App\\EventSubscriber;\n\n';
    expect(implementation('final class Order|Subscriber {}', 'src/EventSubscriber/OrderSubscriber.php', prelude)).toEqual(['OrderSubscriber:42']);
  });

  it('answers nothing for an event without listeners, a non-string constant or another string', () => {
    expect(implementation(`$name = OrderEvents::NOT_AN_|EVENT;`)).toBeNull();
    expect(implementation(`$name = \\App\\Missing::REQ|UEST;`)).toBeNull();
    expect(implementation(`$name = static::REQ|UEST;`)).toBeNull();
    expect(implementation(`$name = 'kernel.res|ponse';`)).toBeNull();
    expect(implementation(`$bus->dispatch('kernel.res|ponse');`)).toBeNull();
    expect(implementation(`$dispatcher->dispatch($event, 'order.pla|ced');`)).toBeNull();
  });
});

describe('EventListenerIndex', () => {
  let parsers: Parsers;

  beforeAll(async () => {
    parsers = await loadParsers();
  });

  const names = (index: EventListenerIndex, event: string, openText?: (file: string) => string | null): string[] =>
    index.listenersOf(event, openText).map((listener) => `${listener.listenerClass.split('\\').pop()}::${listener.method}@${listener.priority}`);

  it('applies the rules of RegisterListenersPass to the attributes and subscribers of src/', () => {
    const index = new EventListenerIndex(fixtureApp, parsers, new ServiceIndex(fixtureApp, parsers));
    expect(names(index, 'App\\Event\\OrderPlacedEvent')).toEqual(['OrderListeners::onPlaced@20', 'InvokableListener::__invoke@0', 'OrderSubscriber::onPlaced@0']);
    expect(names(index, 'order.cancelled')).toEqual(['OrderSubscriber::onCancelled@10', 'OrderListeners::onOrderCancelled@0']);
    // Not literal, untyped, inherited method or computed array: nothing.
    expect(names(index, 'order.cancelled.late')).toEqual([]);
    expect(names(index, 'order.placed')).toEqual([]);
  });

  it('works without a dumped container, from the sources alone (no aliases)', () => {
    const noContainer = { taggedWith: () => [], compiledListeners: () => [], eventAliases: () => new Map() } as unknown as ServiceIndex;
    const index = new EventListenerIndex(fixtureApp, parsers, noContainer);
    expect(names(index, 'kernel.request')).toEqual(['OrderSubscriber::onRequestEarly@100', 'OrderSubscriber::onRequestLate@-100']);
    expect(names(index, 'Symfony\\Component\\HttpKernel\\Event\\RequestEvent')).toEqual(['OrderListeners::onPlaced@20']);
  });

  it('reads an open document rather than the file on disk', () => {
    const index = new EventListenerIndex(fixtureApp, parsers, new ServiceIndex(fixtureApp, parsers));
    const file = path.join(fixtureApp, 'src', 'EventListener', 'InvokableListener.php');
    const source =
      '<?php\nnamespace App\\EventListener;\nuse Symfony\\Component\\EventDispatcher\\Attribute\\AsEventListener;\n' +
      "#[AsEventListener(event: 'order.placed', method: 'now')]\nfinal class InvokableListener\n{\n    public function now(): void {}\n}\n";
    expect(index.updatePhpFile(file, source)).toBe(true);
    expect(names(index, 'order.placed')).toEqual(['InvokableListener::now@0']);
    expect(names(index, 'App\\Event\\OrderPlacedEvent')).not.toContain('InvokableListener::__invoke@0');
    expect(index.updatePhpFile(file, null)).toBe(true);
    expect(names(index, 'order.placed')).toEqual([]);
  });

  it('reads the constants of an open document', () => {
    const index = new EventListenerIndex(fixtureApp, parsers, new ServiceIndex(fixtureApp, parsers));
    const eventsFile = path.join(fixtureApp, 'src', 'Event', 'OrderEvents.php');
    const openText = (file: string): string | null =>
      isSamePath(file, eventsFile) ? "<?php\nnamespace App\\Event;\nfinal class OrderEvents { public const CANCELLED = 'order.voided'; }\n" : null;
    expect(index.constantValue('App\\Event\\OrderEvents', 'CANCELLED', openText)).toBe('order.voided');
    // The default method follows the new name (onOrderVoided, missing): OrderListeners is dropped.
    expect(names(index, 'order.voided', openText)).toEqual(['OrderSubscriber::onCancelled@10']);
  });

  it('reads the listener tags of the services YAML for classes of src/', () => {
    const services = new ServiceIndex(fixtureApp, parsers);
    services.updateYamlFile(
      path.join(fixtureApp, 'config', 'services.yaml'),
      'services:\n    App\\EventSubscriber\\YamlListener:\n        tags:\n' +
        '            - { name: kernel.event_listener, event: order.cancelled }\n' +
        '            - { name: kernel.event_listener, event: kernel.response, method: handle, priority: -8 }\n',
    );
    const index = new EventListenerIndex(fixtureApp, parsers, services);
    expect(names(index, 'order.cancelled')).toContain('YamlListener::onOrderCancelled@0');
    expect(names(index, 'kernel.response')).toEqual(['OrderListeners::onResponse@0', 'OrderSubscriber::onResponse@0', 'YamlListener::handle@-8']);
    const [, , handle] = index.listenersOf('kernel.response');
    expect(handle?.location.range.start).toEqual({ line: 10, character: 20 });
  });
});

describe('listenerMethodName', () => {
  it.each([
    ['kernel.request', 'onKernelRequest'],
    ['kernel.controller_arguments', 'onKernelControllerArguments'],
    ['App\\Event\\OrderPlacedEvent', 'onAppEventOrderPlacedEvent'],
    ['foo-bar.baz2x', 'onFooBarBaz2x'],
  ])('names the default method of %s', (event, method) => {
    expect(listenerMethodName(event)).toBe(method);
  });
});
