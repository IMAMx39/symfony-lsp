import * as path from 'node:path';
import { TextEdit } from 'vscode-languageserver';
import { beforeAll, describe, expect, it } from 'vitest';
import { AutowireReferenceFinder } from '../../../src/features/services/AutowireReferenceFinder';
import { provideParameterCompletion, provideServiceCompletion } from '../../../src/features/services/completion';
import { provideParameterDefinition, provideServiceDefinition } from '../../../src/features/services/definition';
import { ServiceIndex } from '../../../src/index/ServiceIndex';
import type { Parsers } from '../../../src/parsing/parsers';
import { isSamePath, pathToUri, uriToPath } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const phpUri = pathToUri(path.join(fixtureApp, 'src', 'Service', 'Test.php'));
const USE = 'use Symfony\\Component\\DependencyInjection\\Attribute\\Autowire;';

/** A constructor whose single parameter carries `attribute`. */
const php = (attribute: string, imports = USE): string =>
  `<?php\nnamespace App\\Service;\n\n${imports}\n\nfinal class Test\n{\n    public function __construct(${attribute} private $x)\n    {\n    }\n}\n`;

describe('#[Autowire]', () => {
  let parsers: Parsers;
  let finder: AutowireReferenceFinder;
  let index: ServiceIndex;

  beforeAll(async () => {
    parsers = await loadParsers();
    finder = new AutowireReferenceFinder(parsers);
    index = new ServiceIndex(fixtureApp, parsers);
  });

  const at = (source: string) => {
    const { document, offset } = withCursor(phpUri, 'php', source);
    const tree = parsers.parse('php', document.getText())!;
    const references = finder.find(tree.rootNode);
    tree.delete();
    return { document, position: document.positionAt(offset), references };
  };

  const found = (attribute: string, imports = USE) => {
    const source = php(attribute, imports);
    const tree = parsers.parse('php', source)!;
    const { services, parameters } = finder.find(tree.rootNode);
    tree.delete();
    return { services: services.map((reference) => reference.id), parameters: parameters.map((reference) => reference.name) };
  };

  describe('references', () => {
    it('reads service:, param: and the value, named or positional', () => {
      expect(found("#[Autowire(service: 'app.mailer')]")).toEqual({ services: ['app.mailer'], parameters: [] });
      expect(found("#[Autowire(null, 'app.mailer')]")).toEqual({ services: ['app.mailer'], parameters: [] });
      expect(found("#[Autowire('@app.mailer')]")).toEqual({ services: ['app.mailer'], parameters: [] });
      expect(found("#[Autowire(value: '@app.mailer')]")).toEqual({ services: ['app.mailer'], parameters: [] });
      expect(found("#[Autowire(param: 'kernel.debug')]")).toEqual({ services: [], parameters: ['kernel.debug'] });
      expect(found("#[Autowire('%kernel.project_dir%/var/%kernel.environment%')]")).toEqual({
        services: [],
        parameters: ['kernel.project_dir', 'kernel.environment'],
      });
    });

    it('accepts a fully qualified or aliased attribute name', () => {
      expect(found("#[\\Symfony\\Component\\DependencyInjection\\Attribute\\Autowire(service: 'a')]", '').services).toEqual(['a']);
      expect(found("#[Wire(service: 'a')]", 'use Symfony\\Component\\DependencyInjection\\Attribute\\Autowire as Wire;').services).toEqual(['a']);
    });

    it('ignores other Autowire attributes, expressions, env and dynamic values', () => {
      expect(found("#[Autowire(service: 'a')]", 'use App\\Attribute\\Autowire;')).toEqual({ services: [], parameters: [] });
      expect(found("#[Autowire(service: 'a')]", '')).toEqual({ services: [], parameters: [] });
      expect(found("#[Autowire('@@escaped')]")).toEqual({ services: [], parameters: [] });
      expect(found("#[Autowire('@=service(\"a\")')]")).toEqual({ services: [], parameters: [] });
      expect(found("#[Autowire(expression: 'service(\"a\")', env: 'APP_SECRET')]")).toEqual({ services: [], parameters: [] });
      expect(found("#[Autowire(service: self::ID)]")).toEqual({ services: [], parameters: [] });
      expect(found('#[Autowire("%kernel.$x%")]')).toEqual({ services: [], parameters: [] });
    });
  });

  describe('definition', () => {
    const definition = (attribute: string) => {
      const { document, position, references } = at(php(attribute));
      return (
        provideServiceDefinition(document, position, references.services, index) ??
        provideParameterDefinition(document, position, references.parameters, index)
      );
    };

    it('goes to the service of service: and of a @ value', () => {
      for (const attribute of ["#[Autowire(service: 'compiled.on|ly')]", "#[Autowire(|'@compiled.only')]"]) {
        expect(isSamePath(uriToPath(definition(attribute)!.uri), path.join(fixtureApp, 'src', 'Service', 'Newsletter.php'))).toBe(true);
      }
    });

    it('goes to the YAML declaration of a parameter', () => {
      for (const attribute of ["#[Autowire('%app.sen|der%')]", "#[Autowire(param: 'app.sen|der')]", "#[Autowire('x/|%app.sender%')]"]) {
        const location = definition(attribute);
        expect(isSamePath(uriToPath(location!.uri), path.join(fixtureApp, 'config', 'services.yaml'))).toBe(true);
        expect(location!.range.start).toEqual({ line: 1, character: 4 });
      }
    });

    it('returns nothing for container-only parameters, env, unknown names and unclosed placeholders', () => {
      expect(definition("#[Autowire('%kernel.project_d|ir%')]")).toBeNull();
      expect(definition("#[Autowire('%env(APP_SEC|RET)%')]")).toBeNull();
      expect(definition("#[Autowire('%unkn|own%')]")).toBeNull();
      expect(definition("#[Autowire('%app.sen|der')]")).toBeNull();
      expect(definition("#[Autowire('x|/%app.sender%')]")).toBeNull();
    });
  });

  describe('completion', () => {
    const complete = (attribute: string) => {
      const { document, position, references } = at(php(attribute));
      return (
        provideServiceCompletion(document, position, references.services, index.visibleServices()) ??
        provideParameterCompletion(document, position, references.parameters, index.visibleParameters())
      );
    };
    const edit = (items: ReturnType<typeof complete>, label: string) => items?.find((item) => item.label === label)?.textEdit as TextEdit | undefined;

    it('proposes service ids in service: and after @', () => {
      expect(complete("#[Autowire(service: 'app.|')]")?.map((item) => item.label)).toContain('app.mailer');
      const items = complete("#[Autowire('@app|')]");
      expect(edit(items, 'logger')?.newText).toBe('logger');
    });

    it('proposes parameters with their value, without hidden ones', () => {
      const items = complete("#[Autowire(param: 'kernel.|')]")!;
      expect(items.map((item) => item.label)).toContain('kernel.project_dir');
      expect(items.map((item) => item.label)).not.toContain('.kernel.bundles_definition');
      expect(items.find((item) => item.label === 'kernel.project_dir')?.detail).toBe('/var/www/html');
      expect(items.find((item) => item.label === 'app.sender')?.detail).toBe('noreply@example.com');
      expect(edit(items, 'kernel.debug')?.newText).toBe('kernel.debug');
    });

    it('closes a placeholder being typed and keeps a closed one', () => {
      expect(edit(complete("#[Autowire('%kernel.pro|')]"), 'kernel.project_dir')?.newText).toBe('kernel.project_dir%');
      expect(edit(complete("#[Autowire('%|')]"), 'kernel.debug')?.newText).toBe('kernel.debug%');
      const closed = edit(complete("#[Autowire('%kernel.pro|ject%/var')]"), 'kernel.project_dir')!;
      expect(closed.newText).toBe('kernel.project_dir');
      expect(closed.range.end.character - closed.range.start.character).toBe('kernel.project'.length);
    });

    it('stays silent outside a reference', () => {
      expect(complete("#[Autowire('plain|')]")).toBeNull();
      expect(complete("#[Autowire(env: 'APP|')]")).toBeNull();
      expect(complete("#[Autowire('|@app.mailer')]")).toBeNull();
    });
  });
});
