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
import { provideTemplateCompletion } from './features/templates/completion';
import { provideTemplateDefinition } from './features/templates/definition';
import { provideTemplateDiagnostics } from './features/templates/diagnostics';
import { TemplateReferenceFinder, type TemplateReference } from './features/templates/TemplateReferenceFinder';
import { DocumentTrees, languageOf } from './parsing/DocumentTrees';
import { bundledGrammarFiles, Parsers } from './parsing/parsers';
import { ProjectTemplates } from './project/ProjectTemplates';
import { SymfonyProject } from './project/SymfonyProject';
import { MAIN_NAMESPACE } from './project/TwigLoaderPaths';
import { isInsidePath, uriToPath } from './util/paths';

const SERVER_NAME = 'symfony-zed';
const SERVER_VERSION = '0.0.1';
const DIAGNOSTICS_DELAY_MS = 250;
const RELOAD_DELAY_MS = 300;

interface ProjectContext {
  project: SymfonyProject;
  templates: ProjectTemplates;
  reloadTimer?: NodeJS.Timeout;
}

interface ParsingContext {
  parsers: Parsers;
  trees: DocumentTrees;
  templateReferences: TemplateReferenceFinder;
}

interface AnalyzedDocument {
  document: TextDocument;
  context: ProjectContext;
  references: TemplateReference[];
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
    parsing = { parsers, trees: new DocumentTrees(parsers), templateReferences: new TemplateReferenceFinder(parsers) };
  } catch (error) {
    connection.console.error(`[Parsers] Failed to load tree-sitter grammars: ${formatError(error)}`);
  }
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
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
      if (templates !== null) {
        projects.push({ project, templates });
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
    const analyzed = analyze(params.textDocument.uri);
    return analyzed && provideTemplateDefinition(analyzed.document, params.position, analyzed.references, analyzed.context.templates.resolver);
  } catch (error) {
    connection.console.error(`[Definition] ${formatError(error)}`);
    return null;
  }
});

connection.onCompletion((params) => {
  try {
    const analyzed = analyze(params.textDocument.uri);
    if (!analyzed) {
      return null;
    }
    const { document, references, context } = analyzed;
    return provideTemplateCompletion(document, params.position, references, context.templates.index.templates(), context.project.root);
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
        scheduleReload(context);
      } else if (file.endsWith('.twig') && context.templates.index.refresh(file)) {
        touched.add(context);
      }
    }
    touched.forEach(revalidateProject);
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
  return { document, context, references: parsing.templateReferences.find(language, tree.rootNode) };
}

function scheduleDiagnostics(document: TextDocument): void {
  const uri = document.uri;
  clearTimeout(diagnosticTimers.get(uri));
  diagnosticTimers.set(
    uri,
    setTimeout(() => {
      diagnosticTimers.delete(uri);
      publishDiagnostics(uri);
    }, DIAGNOSTICS_DELAY_MS),
  );
}

function publishDiagnostics(uri: string): void {
  try {
    const analyzed = analyze(uri);
    if (!analyzed) {
      return;
    }
    const { document, references, context } = analyzed;
    const { resolver, loaderPaths } = context.templates;
    const diagnostics = provideTemplateDiagnostics(document, references, resolver, (namespace) => loaderPaths.isCertain(namespace));
    void connection.sendDiagnostics({ uri, version: document.version, diagnostics });
  } catch (error) {
    connection.console.error(`[Diagnostics] ${formatError(error)}`);
  }
}

function scheduleReload(context: ProjectContext): void {
  clearTimeout(context.reloadTimer);
  context.reloadTimer = setTimeout(() => {
    try {
      connection.console.info(`[ProjectTemplates] Configuration changed, reloading ${context.project.root}`);
      const templates = buildTemplates(context.project);
      if (templates !== null) {
        context.templates = templates;
        revalidateProject(context);
      }
    } catch (error) {
      connection.console.error(`[ProjectTemplates] Reload failed: ${formatError(error)}`);
    }
  }, RELOAD_DELAY_MS);
}

function revalidateProject(context: ProjectContext): void {
  documents
    .all()
    .filter((document) => projectFor(document.uri) === context)
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

function registerFileWatchers(): void {
  if (!canWatchFiles) {
    connection.console.warn('[Server] Client cannot watch files: restart the server after adding templates');
    return;
  }
  const globs = [
    '**/*.twig',
    '**/config/packages/**/*.yaml',
    '**/config/packages/**/*.yml',
    '**/config/packages/**/*.php',
    '**/config/bundles.php',
    '**/composer.json',
    '**/vendor/composer/installed.json',
  ];
  connection.client
    .register(DidChangeWatchedFilesNotification.type, { watchers: globs.map((globPattern) => ({ globPattern })) })
    .catch((error: unknown) => connection.console.error(`[Server] File watcher registration failed: ${formatError(error)}`));
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
