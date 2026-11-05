import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { provideTemplateDefinition } from './features/templates/definition';
import { TemplateReferenceFinder } from './features/templates/TemplateReferenceFinder';
import { DocumentTrees, languageOf } from './parsing/DocumentTrees';
import { bundledGrammarFiles, Parsers } from './parsing/parsers';
import { SymfonyProject } from './project/SymfonyProject';
import { TemplateResolver } from './project/TemplateResolver';
import { isInsidePath, uriToPath } from './util/paths';

const SERVER_NAME = 'symfony-zed';
const SERVER_VERSION = '0.0.1';

interface ProjectContext {
  project: SymfonyProject;
  templates: TemplateResolver;
}

interface ParsingContext {
  trees: DocumentTrees;
  templateReferences: TemplateReferenceFinder;
}

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceDirs: string[] = [];
let parsing: ParsingContext | null = null;
const projects: ProjectContext[] = [];

connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
  workspaceDirs = collectWorkspaceDirs(params);
  try {
    const parsers = await Parsers.load(bundledGrammarFiles(__dirname));
    parsing = { trees: new DocumentTrees(parsers), templateReferences: new TemplateReferenceFinder(parsers) };
  } catch (error) {
    connection.console.error(`[Parsers] Failed to load tree-sitter grammars: ${formatError(error)}`);
  }
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
    },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
  };
});

connection.onInitialized(() => {
  try {
    connection.console.info(
      `[Server] ${SERVER_NAME} ${SERVER_VERSION} initialized (node ${process.version}, ${process.platform})`,
    );
    if (workspaceDirs.length === 0) {
      connection.console.info('[SymfonyProject] No workspace folder, nothing to detect');
      return;
    }
    for (const dir of workspaceDirs) {
      const project = SymfonyProject.detect(dir);
      if (project === null) {
        connection.console.info(`[SymfonyProject] No Symfony project found in ${dir}`);
        continue;
      }
      projects.push({ project, templates: TemplateResolver.forProject(project) });
      connection.console.info(`[SymfonyProject] Symfony project detected at ${project.root}`);
    }
  } catch (error) {
    connection.console.error(`[Server] Initialization failed: ${formatError(error)}`);
  }
});

connection.onDefinition((params) => {
  try {
    const document = documents.get(params.textDocument.uri);
    const context = document && projectFor(document.uri);
    const language = document && languageOf(document.uri);
    if (!document || !context || !parsing || !language) {
      return null;
    }
    const tree = parsing.trees.get(document);
    if (tree === null) {
      return null;
    }
    const references = parsing.templateReferences.find(language, tree.rootNode);
    return provideTemplateDefinition(document, params.position, references, context.templates);
  } catch (error) {
    connection.console.error(`[Definition] ${formatError(error)}`);
    return null;
  }
});

documents.onDidClose((event) => parsing?.trees.delete(event.document.uri));

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
