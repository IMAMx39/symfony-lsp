import {
  createConnection,
  DidChangeWatchedFilesNotification,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { provideRouteNameCompletion } from './features/routes/completion';
import { provideRouteDefinition } from './features/routes/definition';
import { provideRouteDiagnostics } from './features/routes/diagnostics';
import { provideRouteHover } from './features/routes/hover';
import { provideRouteParameterCompletion } from './features/routes/parameterCompletion';
import { RouteReferenceFinder, type RouteReference } from './features/routes/RouteReferenceFinder';
import { provideServiceCompletion } from './features/services/completion';
import { provideServiceDefinition } from './features/services/definition';
import { provideTemplateCompletion } from './features/templates/completion';
import { provideTemplateDefinition } from './features/templates/definition';
import { provideTemplateDiagnostics } from './features/templates/diagnostics';
import { TemplateReferenceFinder, type TemplateReference } from './features/templates/TemplateReferenceFinder';
import { RouteIndex, routeFileKind } from './index/RouteIndex';
import { SERVICES_ENV, ServiceIndex, serviceFileKind } from './index/ServiceIndex';
import { DocumentTrees, languageOf } from './parsing/DocumentTrees';
import { bundledGrammarFiles, Parsers } from './parsing/parsers';
import { ProjectTemplates } from './project/ProjectTemplates';
import { SymfonyProject } from './project/SymfonyProject';
import { MAIN_NAMESPACE } from './project/TwigLoaderPaths';
import { findServiceReferences, type ServiceReference } from './services/yamlServices';
import { isInsidePath, pathKey, uriToPath } from './util/paths';

const SERVER_NAME = 'symfony-zed';
const SERVER_VERSION = '0.0.1';
const DIAGNOSTICS_DELAY_MS = 250;
const RELOAD_DELAY_MS = 300;

interface ProjectContext {
  project: SymfonyProject;
  templates: ProjectTemplates;
  routes: RouteIndex;
  services: ServiceIndex;
  reloadTimers: Map<string, NodeJS.Timeout>;
}

interface ParsingContext {
  parsers: Parsers;
  trees: DocumentTrees;
  templateReferences: TemplateReferenceFinder;
  routeReferences: RouteReferenceFinder;
}

interface AnalyzedDocument {
  document: TextDocument;
  context: ProjectContext;
  templates: TemplateReference[];
  routes: RouteReference[];
}

interface AnalyzedServicesYaml {
  document: TextDocument;
  context: ProjectContext;
  references: ServiceReference[];
}

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceDirs: string[] = [];
let canWatchFiles = false;
let parsing: ParsingContext | null = null;
const projects: ProjectContext[] = [];
const diagnosticTimers = new Map<string, NodeJS.Timeout>();

connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
  workspaceDirs = collectWorkspaceDirs(params);
  canWatchFiles = params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
  try {
    const parsers = await Parsers.load(bundledGrammarFiles(__dirname));
    parsing = {
      parsers,
      trees: new DocumentTrees(parsers),
      templateReferences: new TemplateReferenceFinder(parsers),
      routeReferences: new RouteReferenceFinder(parsers),
    };
  } catch (error) {
    connection.console.error(`[Parsers] Failed to load tree-sitter grammars: ${formatError(error)}`);
  }
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      hoverProvider: true,
      completionProvider: { triggerCharacters: ["'", '"', '/', '@'] },
    },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
  };
});

connection.onInitialized(() => {
  try {
    connection.console.info(
      `[Server] ${SERVER_NAME} ${SERVER_VERSION} initialized (node ${process.version}, ${process.platform})`,
    );
    for (const dir of workspaceDirs) {
      const project = SymfonyProject.detect(dir);
      if (project === null) {
        connection.console.info(`[SymfonyProject] No Symfony project found in ${dir}`);
        continue;
      }
      connection.console.info(`[SymfonyProject] Symfony project detected at ${project.root}`);
      const templates = buildTemplates(project);
      const routes = buildRoutes(project);
      const services = buildServices(project);
      if (templates !== null && routes !== null && services !== null) {
        projects.push({ project, templates, routes, services, reloadTimers: new Map() });
      }
    }
    if (projects.length > 0) {
      registerFileWatchers();
      documents.all().forEach(scheduleDiagnostics);
    }
  } catch (error) {
    connection.console.error(`[Server] Initialization failed: ${formatError(error)}`);
  }
});

connection.onDefinition((params) => {
  try {
    const servicesYaml = analyzeServicesYaml(params.textDocument.uri);
    if (servicesYaml) {
      const { document, context, references } = servicesYaml;
      return provideServiceDefinition(document, params.position, references, context.services);
    }
    const analyzed = analyze(params.textDocument.uri);
    if (!analyzed) {
      return null;
    }
    const { document, context } = analyzed;
    return (
      provideTemplateDefinition(document, params.position, analyzed.templates, context.templates.resolver) ??
      provideRouteDefinition(document, params.position, analyzed.routes, context.routes)
    );
  } catch (error) {
    connection.console.error(`[Definition] ${formatError(error)}`);
    return null;
  }
});

connection.onHover((params) => {
  try {
    const analyzed = analyze(params.textDocument.uri);
    return analyzed && provideRouteHover(analyzed.document, params.position, analyzed.routes, analyzed.context.routes, analyzed.context.project.root);
  } catch (error) {
    connection.console.error(`[Hover] ${formatError(error)}`);
    return null;
  }
});

connection.onCompletion((params) => {
  try {
    const servicesYaml = analyzeServicesYaml(params.textDocument.uri);
    if (servicesYaml) {
      const { document, context, references } = servicesYaml;
      return provideServiceCompletion(document, params.position, references, context.services.visibleServices());
    }
    const analyzed = analyze(params.textDocument.uri);
    if (!analyzed) {
      return null;
    }
    const { document, context } = analyzed;
    return (
      provideTemplateCompletion(document, params.position, analyzed.templates, context.templates.index.templates(), context.project.root) ??
      provideRouteNameCompletion(document, params.position, analyzed.routes, context.routes.visibleRoutes()) ??
      provideRouteParameterCompletion(document, params.position, analyzed.routes, context.routes)
    );
  } catch (error) {
    connection.console.error(`[Completion] ${formatError(error)}`);
    return null;
  }
});

connection.onDidChangeWatchedFiles((params) => {
  try {
    const touched = new Set<ProjectContext>();
    for (const change of params.changes) {
      const file = uriToPath(change.uri);
      const context = projects.find((candidate) => isInsidePath(file, candidate.project.root));
      if (!context) {
        continue;
      }
      if (ProjectTemplates.isConfigFile(file, context.project.root)) {
        scheduleReload(context, 'templates', () => {
          const templates = buildTemplates(context.project);
          if (templates !== null) {
            context.templates = templates;
          }
        });
      } else if (file.endsWith('.twig') && context.templates.index.refresh(file)) {
        touched.add(context);
      }

      switch (routeFileKind(file, context.project.root)) {
        case 'routing-config':
          scheduleReload(context, 'routing-config', () => context.routes.reloadYaml());
          break;
        case 'compiled':
          scheduleReload(context, 'compiled-routes', () => context.routes.reloadCompiled());
          break;
        case 'autoload':
          scheduleReload(context, 'autoload', () => {
            context.routes.reloadAutoload();
            context.services.reloadAutoload();
          });
          break;
        case 'source':
          // An open document is the source of truth for its file.
          if (!openDocumentFor(file) && context.routes.updatePhpFile(file, null)) {
            touched.add(context);
          }
          break;
      }

      switch (serviceFileKind(file, context.project.root)) {
        case 'services-config':
          if (!openDocumentFor(file)) {
            context.services.updateYamlFile(file, null);
          }
          break;
        case 'container':
          scheduleReload(context, 'container', () => context.services.reloadContainer());
          break;
      }
    }
    touched.forEach((context) => revalidateProject(context));
  } catch (error) {
    connection.console.error(`[WatchedFiles] ${formatError(error)}`);
  }
});

documents.onDidChangeContent((event) => scheduleDiagnostics(event.document));

documents.onDidClose((event) => {
  const uri = event.document.uri;
  clearTimeout(diagnosticTimers.get(uri));
  diagnosticTimers.delete(uri);
  parsing?.trees.delete(uri);
  void connection.sendDiagnostics({ uri, diagnostics: [] });
  // Back to the file on disk (unsaved changes are discarded).
  const context = projectFor(uri);
  context?.services.updateYamlFile(uriToPath(uri), null);
  if (context?.routes.updatePhpFile(uriToPath(uri), null)) {
    revalidateProject(context);
  }
});

function analyze(uri: string): AnalyzedDocument | null {
  const document = documents.get(uri);
  const context = document && projectFor(document.uri);
  const language = document && languageOf(document.uri);
  if (!document || !context || !parsing || !language) {
    return null;
  }
  const tree = parsing.trees.get(document);
  if (tree === null) {
    return null;
  }
  return {
    document,
    context,
    templates: parsing.templateReferences.find(language, tree.rootNode),
    routes: parsing.routeReferences.find(language, tree.rootNode),
  };
}

/** An open config/services{,_dev}.yaml of a project, with its `'@id'` references. */
function analyzeServicesYaml(uri: string): AnalyzedServicesYaml | null {
  const document = documents.get(uri);
  const context = document && projectFor(uri);
  if (!document || !context || serviceFileKind(uriToPath(uri), context.project.root) !== 'services-config') {
    return null;
  }
  return { document, context, references: findServiceReferences(document.getText(), SERVICES_ENV) };
}

function scheduleDiagnostics(document: TextDocument): void {
  const uri = document.uri;
  clearTimeout(diagnosticTimers.get(uri));
  diagnosticTimers.set(
    uri,
    setTimeout(() => {
      diagnosticTimers.delete(uri);
      refreshDocument(uri);
    }, DIAGNOSTICS_DELAY_MS),
  );
}

/** Updates the indexes from an open document, then publishes its diagnostics. */
function refreshDocument(uri: string): void {
  try {
    const document = documents.get(uri);
    const context = document && projectFor(uri);
    if (!document || !context) {
      return;
    }
    if (languageOf(uri) === 'php' && context.routes.updatePhpFile(uriToPath(uri), document.getText())) {
      revalidateProject(context, uri);
    }
    context.services.updateYamlFile(uriToPath(uri), document.getText());
    publishDiagnostics(uri);
  } catch (error) {
    connection.console.error(`[Diagnostics] ${formatError(error)}`);
  }
}

function publishDiagnostics(uri: string): void {
  const analyzed = analyze(uri);
  if (!analyzed) {
    return;
  }
  const { document, context } = analyzed;
  const { resolver, loaderPaths } = context.templates;
  const diagnostics = [
    ...provideTemplateDiagnostics(document, analyzed.templates, resolver, (namespace) => loaderPaths.isCertain(namespace)),
    ...provideRouteDiagnostics(document, analyzed.routes, context.routes),
  ];
  void connection.sendDiagnostics({ uri, version: document.version, diagnostics });
}

function scheduleReload(context: ProjectContext, key: string, reload: () => void): void {
  clearTimeout(context.reloadTimers.get(key));
  context.reloadTimers.set(
    key,
    setTimeout(() => {
      context.reloadTimers.delete(key);
      try {
        connection.console.info(`[Server] ${key} changed, reloading ${context.project.root}`);
        reload();
        revalidateProject(context);
      } catch (error) {
        connection.console.error(`[Server] Reload of ${key} failed: ${formatError(error)}`);
      }
    }, RELOAD_DELAY_MS),
  );
}

function revalidateProject(context: ProjectContext, exceptUri?: string): void {
  documents
    .all()
    .filter((document) => document.uri !== exceptUri && projectFor(document.uri) === context)
    .forEach(scheduleDiagnostics);
}

function buildTemplates(project: SymfonyProject): ProjectTemplates | null {
  if (parsing === null) {
    return null;
  }
  const templates = ProjectTemplates.build(project.root, parsing.parsers);
  const { namespaces, warnings } = templates.loaderPaths;
  for (const warning of warnings) {
    connection.console.warn(`[TwigLoaderPaths] ${warning}`);
  }
  const summary = [...namespaces]
    .map(([namespace, dirs]) => `${namespace === MAIN_NAMESPACE ? '(main)' : `@${namespace}`}: ${dirs.length}`)
    .join(', ');
  connection.console.info(`[TwigLoaderPaths] Template namespaces: ${summary || 'none'}`);
  connection.console.info(`[TemplateIndex] ${templates.index.templates().length} templates indexed`);
  return templates;
}

function buildRoutes(project: SymfonyProject): RouteIndex | null {
  if (parsing === null) {
    return null;
  }
  const routes = new RouteIndex(project.root, parsing.parsers);
  connection.console.info(
    `[RouteIndex] ${routes.visibleRoutes().length} routes indexed` +
      (routes.isCertain() ? '' : ' (incomplete: unknown routes are not reported)'),
  );
  return routes;
}

function buildServices(project: SymfonyProject): ServiceIndex | null {
  if (parsing === null) {
    return null;
  }
  const services = new ServiceIndex(project.root, parsing.parsers);
  connection.console.info(
    `[ServiceIndex] ${services.visibleServices().length} services indexed` +
      (services.hasContainer() ? '' : ' (no compiled container in var/cache/dev: only services declared in YAML are known)'),
  );
  return services;
}

function registerFileWatchers(): void {
  if (!canWatchFiles) {
    connection.console.warn('[Server] Client cannot watch files: restart the server after adding templates, routes or services');
    return;
  }
  const globs = [
    '**/*.twig',
    '**/config/packages/**/*.yaml',
    '**/config/packages/**/*.yml',
    '**/config/packages/**/*.php',
    '**/config/bundles.php',
    '**/config/routes.yaml',
    '**/config/routes.php',
    '**/config/routes/**/*.yaml',
    '**/config/routes/**/*.yml',
    '**/config/routes/**/*.php',
    '**/src/**/*.php',
    '**/var/cache/dev/url_generating_routes.php',
    '**/var/cache/dev/url_matching_routes.php',
    '**/config/services*.yaml',
    '**/var/cache/dev/*Container.xml',
    '**/composer.json',
    '**/vendor/composer/installed.json',
  ];
  connection.client
    .register(DidChangeWatchedFilesNotification.type, { watchers: globs.map((globPattern) => ({ globPattern })) })
    .catch((error: unknown) => connection.console.error(`[Server] File watcher registration failed: ${formatError(error)}`));
}

function openDocumentFor(file: string): TextDocument | undefined {
  const key = pathKey(file);
  return documents.all().find((document) => pathKey(uriToPath(document.uri)) === key);
}

function projectFor(uri: string): ProjectContext | undefined {
  const file = uriToPath(uri);
  return projects.find((context) => isInsidePath(file, context.project.root));
}

function collectWorkspaceDirs(params: InitializeParams): string[] {
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    return params.workspaceFolders.map((folder) => uriToPath(folder.uri));
  }
  if (params.rootUri) {
    return [uriToPath(params.rootUri)];
  }
  return [];
}

function formatError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

documents.listen(connection);
connection.listen();
