import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { provideMessageHandlerImplementation } from '../../../src/features/messenger/implementation';
import { MessageClassReferenceFinder } from '../../../src/features/messenger/MessageClassReferenceFinder';
import { MessageHandlerIndex } from '../../../src/index/MessageHandlerIndex';
import { ServiceIndex } from '../../../src/index/ServiceIndex';
import type { Parsers } from '../../../src/parsing/parsers';
import { isSamePath, pathToUri, uriToPath } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const PRELUDE = '<?php\nnamespace App\\Controller;\nuse App\\Message\\CreateOrder;\nuse App\\Message as M;\n';

describe('message handler implementation', () => {
  let parsers: Parsers;
  let finder: MessageClassReferenceFinder;
  let index: MessageHandlerIndex;

  beforeAll(async () => {
    parsers = await loadParsers();
    finder = new MessageClassReferenceFinder(parsers);
    index = new MessageHandlerIndex(fixtureApp, parsers, new ServiceIndex(fixtureApp, parsers));
  });

  /** Handlers found at the cursor, as `ShortClass::line` (0-based line of the method name). */
  function implementation(code: string, file = 'src/Controller/TestController.php', prelude = PRELUDE): string[] | null {
    const { document, offset } = withCursor(pathToUri(path.join(fixtureApp, file)), 'php', prelude + code);
    const tree = parsers.parse('php', document.getText())!;
    const references = finder.find(tree.rootNode);
    tree.delete();
    const locations = provideMessageHandlerImplementation(document, document.positionAt(offset), references, index);
    return locations && locations.map((location) => `${path.basename(uriToPath(location.uri), '.php')}:${location.range.start.line}`);
  }

  const createOrderHandlers = ['CreateOrderHandler:10', 'OrderHandlers:20', 'OrderHandlers:15', 'AuditHandler:6'];

  it.each([
    ['new X()', `$bus->dispatch(new Create|Order(42));`],
    ['the end of the name', `$bus->dispatch(new CreateOrder|(42));`],
    ['X::class', `$class = Create|Order::class;`],
    ['an aliased namespace', `$bus->dispatch(new M\\Create|Order(42));`],
    ['a fully qualified name', `$bus->dispatch(new \\App\\Message\\Create|Order(42));`],
    ['a type hint', `function f(?Create|Order $message) {}`],
  ])('lists the handlers of the message from %s', (_label, code) => {
    expect(implementation(code)).toEqual(createOrderHandlers);
  });

  it('lists the handlers from the declaration of the message', () => {
    const prelude = '<?php\n\nnamespace App\\Message;\n\n';
    expect(implementation('final class Create|Order extends OrderMessage\n{\n}\n', 'src/Message/CreateOrder.php', prelude)).toEqual(createOrderHandlers);
  });

  it('orders exact handlers by priority, then parents, then interfaces', () => {
    expect(implementation(`$bus->dispatch(new M\\Cancel|Order(42));`)).toEqual([
      'OrderHandlers:10',
      'ExplicitHandler:10',
      'OrderHandlers:20',
      'AuditHandler:10',
      'OrderHandlers:15',
      'AuditHandler:6',
    ]);
  });

  it('lists the handlers of a parent class or an interface', () => {
    expect(implementation(`function f(M\\Order|Message $message) {}`)).toEqual(['OrderHandlers:15', 'AuditHandler:6']);
    expect(implementation(`function f(\\Acme\\FooBundle\\Messenger\\Auditable|Message $message) {}`)).toEqual(['AuditHandler:6']);
  });

  it('answers nothing for a class without handlers, an unknown class or another constant', () => {
    expect(implementation(`$bus->dispatch(new M\\Unhan|dled());`)).toBeNull();
    expect(implementation(`$bus->dispatch(new M\\Miss|ing());`)).toBeNull();
    expect(implementation(`$x = CreateOrder::NA|ME;`)).toBeNull();
    expect(implementation(`$x = $create|Order;`)).toBeNull();
  });
});

describe('MessageHandlerIndex', () => {
  let parsers: Parsers;

  beforeAll(async () => {
    parsers = await loadParsers();
  });

  const handlerFile = (name: string): string => path.join(fixtureApp, 'src', 'MessageHandler', `${name}.php`);
  const names = (index: MessageHandlerIndex, message: string, openText?: (file: string) => string | null): string[] =>
    index.handlersOf(message, openText).map((handler) => `${handler.handlerClass.split('\\').pop()}::${handler.method}`);

  it('ignores abstract classes, dynamic or foreign attributes, untyped or intersection parameters and stale dumped attribute tags', () => {
    const index = new MessageHandlerIndex(fixtureApp, parsers, new ServiceIndex(fixtureApp, parsers));
    expect(index.handlersOf('App\\Message\\Unhandled')).toEqual([]);
    expect(index.attributeHandlerCount()).toBe(5);
  });

  it('works without tagged services, from the attributes alone', () => {
    const noTags = { taggedWith: () => [] } as unknown as ServiceIndex;
    const index = new MessageHandlerIndex(fixtureApp, parsers, noTags);
    expect(names(index, 'App\\Message\\CreateOrder')).toEqual(['CreateOrderHandler::__invoke', 'OrderHandlers::onUnion', 'OrderHandlers::onAnyOrder']);
  });

  it('reads an open document rather than the file on disk', () => {
    const index = new MessageHandlerIndex(fixtureApp, parsers, new ServiceIndex(fixtureApp, parsers));
    const source =
      '<?php\nnamespace App\\MessageHandler;\nuse App\\Message\\Unhandled;\nuse Symfony\\Component\\Messenger\\Attribute\\AsMessageHandler;\n' +
      'final class StaleHandler\n{\n    #[AsMessageHandler]\n    public function now(Unhandled $message): void {}\n}\n';
    expect(index.updatePhpFile(handlerFile('StaleHandler'), source)).toBe(true);
    expect(names(index, 'App\\Message\\Unhandled')).toEqual(['StaleHandler::now']);
    expect(index.updatePhpFile(handlerFile('StaleHandler'), null)).toBe(true);
    expect(names(index, 'App\\Message\\Unhandled')).toEqual([]);
  });

  it('follows the hierarchy of an open message document', () => {
    const index = new MessageHandlerIndex(fixtureApp, parsers, new ServiceIndex(fixtureApp, parsers));
    const messageFile = path.join(fixtureApp, 'src', 'Message', 'Unhandled.php');
    const openText = (file: string): string | null =>
      isSamePath(file, messageFile) ? '<?php\nnamespace App\\Message;\nfinal class Unhandled extends OrderMessage {}\n' : null;
    expect(names(index, 'App\\Message\\Unhandled', openText)).toEqual(['OrderHandlers::onAnyOrder', 'AuditHandler::__invoke']);
  });

  it('reads the handler tags of the services YAML', () => {
    const services = new ServiceIndex(fixtureApp, parsers);
    services.updateYamlFile(
      path.join(fixtureApp, 'config', 'services.yaml'),
      'services:\n    App\\MessageHandler\\YamlHandler:\n        tags:\n            - { name: messenger.message_handler, handles: App\\Message\\Unhandled, method: handle }\n',
    );
    const index = new MessageHandlerIndex(fixtureApp, parsers, services);
    const [handler] = index.handlersOf('App\\Message\\Unhandled');
    expect(handler && `${handler.handlerClass}::${handler.method}`).toBe('App\\MessageHandler\\YamlHandler::handle');
    expect(handler && isSamePath(uriToPath(handler.location.uri), handlerFile('YamlHandler'))).toBe(true);
    expect(handler?.location.range.start).toEqual({ line: 6, character: 20 });
  });

  it('drops option-less tags when the service has configured ones, as MessengerPass does', () => {
    const services = new ServiceIndex(fixtureApp, parsers);
    services.updateYamlFile(
      path.join(fixtureApp, 'config', 'services.yaml'),
      'services:\n    app.audit:\n        class: Acme\\FooBundle\\Messenger\\AuditHandler\n        tags:\n' +
        '            - messenger.message_handler\n            - { messenger.message_handler: { handles: App\\Message\\Unhandled, method: logCancel } }\n',
    );
    const index = new MessageHandlerIndex(fixtureApp, parsers, services);
    expect(names(index, 'App\\Message\\Unhandled')).toEqual(['AuditHandler::logCancel']);
  });
});
