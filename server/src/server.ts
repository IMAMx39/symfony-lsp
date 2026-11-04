import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymfonyProject } from './project/SymfonyProject';
import { uriToPath } from './util/paths';

const SERVER_NAME = 'symfony-zed';
const SERVER_VERSION = '0.0.1';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceDirs: string[] = [];
const projects: SymfonyProject[] = [];

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceDirs = collectWorkspaceDirs(params);
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
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
      projects.push(project);
      connection.console.info(`[SymfonyProject] Symfony project detected at ${project.root}`);
    }
  } catch (error) {
    connection.console.error(`[Server] Initialization failed: ${formatError(error)}`);
  }
});

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
