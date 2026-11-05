import * as path from 'node:path';
import type { MarkupContent } from 'vscode-languageserver';
import { beforeAll, describe, expect, it } from 'vitest';
import { AutowireReferenceFinder } from '../../../src/features/services/AutowireReferenceFinder';
import { provideServiceHover } from '../../../src/features/services/hover';
import { ServiceIndex } from '../../../src/index/ServiceIndex';
import type { Parsers } from '../../../src/parsing/parsers';
import { findServiceReferences } from '../../../src/services/yamlServices';
import { pathToUri } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const yamlUri = pathToUri(path.join(fixtureApp, 'config', 'services.yaml'));
const phpUri = pathToUri(path.join(fixtureApp, 'src', 'Service', 'Test.php'));

describe('service hover', () => {
  let parsers: Parsers;
  let index: ServiceIndex;

  beforeAll(async () => {
    parsers = await loadParsers();
    index = new ServiceIndex(fixtureApp, parsers);
  });

  const hoverYaml = (argument: string): string | null => {
    const { document, offset } = withCursor(yamlUri, 'yaml', `services:\n    foo:\n        arguments: [${argument}]\n`);
    const result = provideServiceHover(document, document.positionAt(offset), findServiceReferences(document.getText(), 'dev'), index, fixtureApp);
    return result === null ? null : (result.contents as MarkupContent).value;
  };

  it('shows class, tags and declaration of a YAML-declared service', () => {
    expect(hoverYaml("'@app.news|letter'")).toBe(
      [
        '**app.newsletter**',
        'Class: `App\\Service\\Newsletter`',
        'Tags: `app.tag`, `kernel.event_listener`, `app.named_tag`',
        'Defined in `config/services.yaml:31`',
      ].join('\n\n'),
    );
  });

  it('follows alias chains and lists the other aliases of the target', () => {
    expect(hoverYaml("'@app.mailer_sh|ort'")).toBe(
      [
        '**app.mailer_short** → alias of **App\\Service\\Mailer**',
        'Class: `App\\Service\\Mailer`',
        'Aliases: `app.mailer`',
        'Defined in `config/services.yaml:37`',
      ].join('\n\n'),
    );
  });

  it('describes container-only services, located on their class', () => {
    expect(hoverYaml("'@?Psr\\Log\\Logger|Interface'")).toBe(
      ['**Psr\\Log\\LoggerInterface** → alias of **logger**', 'Class: `Symfony\\Component\\HttpKernel\\Log\\Logger`', 'Tags: `kernel.reset`'].join('\n\n'),
    );
    expect(hoverYaml("'@compiled.on|ly'")).toContain('Defined in `src/Service/Newsletter.php:5`');
  });

  it('works on #[Autowire] references', () => {
    const source = `<?php\nuse Symfony\\Component\\DependencyInjection\\Attribute\\Autowire;\nclass T { public function __construct(#[Autowire(service: 'log|ger')] $l) {} }\n`;
    const { document, offset } = withCursor(phpUri, 'php', source);
    const tree = parsers.parse('php', document.getText())!;
    const { services } = new AutowireReferenceFinder(parsers).find(tree.rootNode);
    tree.delete();
    const result = provideServiceHover(document, document.positionAt(offset), services, index, fixtureApp);
    expect((result?.contents as MarkupContent).value).toMatch(/^\*\*logger\*\*\n\nClass: /);
    expect((result?.contents as MarkupContent).value).toContain('Aliases: `Psr\\Log\\LoggerInterface`');
  });

  it('returns nothing for unknown services or outside a reference', () => {
    expect(hoverYaml("'@unkno|wn'")).toBeNull();
    expect(hoverYaml("'%app.sen|der%'")).toBeNull();
  });
});
