import * as fs from 'node:fs';
import * as path from 'node:path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { beforeAll, describe, expect, it } from 'vitest';
import { provideTemplateDefinition } from '../../../src/features/templates/definition';
import { TemplateReferenceFinder } from '../../../src/features/templates/TemplateReferenceFinder';
import type { Parsers } from '../../../src/parsing/parsers';
import { SymfonyProject } from '../../../src/project/SymfonyProject';
import { TemplateResolver } from '../../../src/project/TemplateResolver';
import { isSamePath, pathToUri, uriToPath } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const controllerUri = pathToUri(path.join(fixtureApp, 'src', 'Controller', 'TestController.php'));
const template = (name: string): string => path.join(fixtureApp, 'templates', ...name.split('/'));

describe('PHP template definition', () => {
  let parsers: Parsers;
  let finder: TemplateReferenceFinder;
  let resolver: TemplateResolver;

  beforeAll(async () => {
    parsers = await loadParsers();
    finder = new TemplateReferenceFinder(parsers);
    resolver = TemplateResolver.forProject(SymfonyProject.detect(fixtureApp)!);
  });

  function definitionAt(source: string): string | null {
    const { document, offset } = withCursor(controllerUri, 'php', source);
    return definitionIn(document, offset);
  }

  function definitionIn(document: TextDocument, offset: number): string | null {
    const tree = parsers.parse('php', document.getText())!;
    const references = finder.findInPhp(tree.rootNode);
    const location = provideTemplateDefinition(document, document.positionAt(offset), references, resolver);
    tree.delete();
    return location === null ? null : uriToPath(location.uri);
  }

  function expectTemplate(actual: string | null, name: string): void {
    expect(actual).not.toBeNull();
    expect(isSamePath(actual!, template(name))).toBe(true);
  }

  it.each([
    ['render', `<?php $this->render('home/in|dex.html.twig');`],
    ['renderView', `<?php $this->renderView('home/index.html.twig|');`],
    ['renderBlock', `<?php $this->renderBlock('home/index.html.twig', 'body', ['a' => 1]);`.replace("'home", "'|home")],
    ['renderBlockView', `<?php $this->renderBlockView('ho|me/index.html.twig', 'body');`],
    ['double-quoted literal', `<?php $this->render("home/index|.html.twig");`],
    ['cursor on the opening quote', `<?php $this->render(|'home/index.html.twig');`],
    ['Twig\\Environment::render', `<?php $this->twig->render('home/index|.html.twig');`],
    ['#[Template]', `<?php class A { #[Template('home/index|.html.twig')] public function a() {} }`],
    ['fully qualified #[Template]', `<?php class A { #[\\Symfony\\Bridge\\Twig\\Attribute\\Template('home/|index.html.twig')] public function a() {} }`],
  ])('resolves %s', (_label, source) => {
    expectTemplate(definitionAt(source), 'home/index.html.twig');
  });

  it('resolves the fixture controller', () => {
    const file = path.join(fixtureApp, 'src', 'Controller', 'HomeController.php');
    const text = fs.readFileSync(file, 'utf8');
    const document = TextDocument.create(pathToUri(file), 'php', 1, text);
    expectTemplate(definitionIn(document, text.indexOf("'home/_hero") + 3), 'home/_hero.html.twig');
    expectTemplate(definitionIn(document, text.indexOf("'admin/dashboard") + 3), 'admin/dashboard.html.twig');
  });

  it('handles CRLF line endings and non-ASCII text before the call', () => {
    const source = `<?php\r\n// déjà vu 😀\r\n$this->render('home/index|.html.twig');\r\n`;
    expectTemplate(definitionAt(source), 'home/index.html.twig');
  });

  it('still resolves earlier calls when the file is being edited', () => {
    const source = `<?php\nclass A {\n  public function a() { return $this->render('home/in|dex.html.twig'); }\n  public function b() { $this->render('unterminated`;
    expectTemplate(definitionAt(source), 'home/index.html.twig');
  });

  it.each([
    ['concatenation', `<?php $this->render('home/' . $na|me);`],
    ['concatenated literal', `<?php $this->render('home/in|dex' . '.html.twig');`],
    ['variable', `<?php $this->render($templ|ate);`],
    ['interpolated string', `<?php $this->render("home/{$na|me}.html.twig");`],
    ['missing template', `<?php $this->render('home/miss|ing.html.twig');`],
    ['wrong case', `<?php $this->render('Home/In|dex.html.twig');`],
    ['directory', `<?php $this->render('ho|me');`],
    ['parent traversal', `<?php $this->render('home/../ba|se.html.twig');`],
    ['unrelated method', `<?php $this->redirect('home/index|.html.twig');`],
    ['second argument', `<?php $this->renderBlock('home/index.html.twig', 'home/index|.html.twig');`],
    ['named argument', `<?php $this->render(view: 'home/index|.html.twig');`],
    ['other attribute', `<?php class A { #[Route('home/index|.html.twig')] public function a() {} }`],
    ['cursor outside the literal', `<?php $this->render('home/index.html.twig')|;`],
    ['namespaced name (not supported yet)', `<?php $this->render('@Foo/ba|r.html.twig');`],
  ])('returns nothing for %s', (_label, source) => {
    expect(definitionAt(source)).toBeNull();
  });
});
