import * as path from 'node:path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { beforeAll, describe, expect, it } from 'vitest';
import { provideRouteNameCompletion } from '../../../src/features/routes/completion';
import { provideRouteDefinition } from '../../../src/features/routes/definition';
import { provideRouteDiagnostics, ROUTE_NOT_FOUND } from '../../../src/features/routes/diagnostics';
import { provideRouteHover } from '../../../src/features/routes/hover';
import { RouteIndex } from '../../../src/index/RouteIndex';
import { findSecurityReferences } from '../../../src/security/securityYaml';
import { isSamePath, pathToUri, uriToPath } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const securityUri = pathToUri(path.join(fixtureApp, 'config', 'packages', 'security.yaml'));
const firewall = (options: string): string => `security:\n    firewalls:\n        main:\n${options}`;

describe('routes in security.yaml', () => {
  let routes: RouteIndex;

  beforeAll(async () => {
    routes = new RouteIndex(fixtureApp, await loadParsers());
  });

  const at = (source: string) => {
    const { document, offset } = withCursor(securityUri, 'yaml', source);
    return { document, position: document.positionAt(offset), references: findSecurityReferences(document.getText(), 'dev').routes };
  };

  it('goes to the #[Route] of a login path given as a route name', () => {
    const { document, position, references } = at(firewall('            form_login:\n                login_path: app_lo|gin\n'));
    const location = provideRouteDefinition(document, position, references, routes);
    expect(isSamePath(uriToPath(location!.uri), path.join(fixtureApp, 'src', 'Controller', 'SecurityController.php'))).toBe(true);
  });

  it('completes route names, unquoted or quoted, replacing the whole name', () => {
    for (const [source, start, end] of [
      ['                path: app_|lo\n', 22, 28],
      ["                path: 'app_|lo'\n", 23, 29],
    ] as const) {
      const { document, position, references } = at(firewall(`            logout:\n${source}`));
      const items = provideRouteNameCompletion(document, position, references, routes.visibleRoutes())!;
      expect(items.map((item) => item.label)).toContain('app_logout');
      const edit = items[0]!.textEdit as { range: { start: { character: number }; end: { character: number } } };
      expect([edit.range.start.character, edit.range.end.character]).toEqual([start, end]);
    }
  });

  it('shows the route of access_control on hover', () => {
    const { document, position, references } = at('security:\n    access_control:\n        - { route: blog_sh|ow, roles: ROLE_USER }\n');
    const hover = provideRouteHover(document, position, references, routes, fixtureApp);
    expect(JSON.stringify(hover?.contents)).toContain('blog_show');
  });

  it('reports unknown route names, not paths', () => {
    const source = firewall('            form_login: { login_path: app_login, check_path: nope }\n            logout: { path: /logout, target: gone }\n');
    const document = TextDocument.create(securityUri, 'yaml', 1, source);
    const diagnostics = provideRouteDiagnostics(document, findSecurityReferences(source, 'dev').routes, routes);
    expect(diagnostics.map((diagnostic) => [diagnostic.code, document.getText(diagnostic.range)])).toEqual([
      [ROUTE_NOT_FOUND, 'nope'],
      [ROUTE_NOT_FOUND, 'gone'],
    ]);
  });
});
