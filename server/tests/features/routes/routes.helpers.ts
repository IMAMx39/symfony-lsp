import * as path from 'node:path';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { RouteReferenceFinder, type RouteReference } from '../../../src/features/routes/RouteReferenceFinder';
import { RouteIndex } from '../../../src/index/RouteIndex';
import type { DocumentLanguage } from '../../../src/parsing/parsers';
import { pathToUri } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

export interface RouteTestContext {
  index: RouteIndex;
  /** Parses `source` (with a cursor marker) and returns its route references. */
  at(language: DocumentLanguage, source: string, marker?: string): { document: TextDocument; offset: number; references: RouteReference[] };
}

let context: Promise<RouteTestContext> | undefined;

export function routeTestContext(): Promise<RouteTestContext> {
  context ??= (async () => {
    const parsers = await loadParsers();
    const finder = new RouteReferenceFinder(parsers);
    const index = new RouteIndex(fixtureApp, parsers);
    return {
      index,
      at(language, source, marker = '|') {
        const file = path.join(fixtureApp, language === 'php' ? 'src/Controller/TestController.php' : 'templates/test.html.twig');
        const { document, offset } = withCursor(pathToUri(file), language, source, marker);
        const tree = parsers.parse(language, document.getText())!;
        const references = finder.find(language, tree.rootNode);
        tree.delete();
        return { document, offset, references };
      },
    };
  })();
  return context;
}
