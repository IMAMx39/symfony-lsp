import * as path from 'node:path';
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
import { DoctrineEntities } from './doctrine/DoctrineEntities';
import { provideRepositoryDefinition } from './features/doctrine/definition';
import { provideFormFieldCompletion } from './features/doctrine/formFieldCompletion';
import { FormFieldReferenceFinder, type FormFieldReference } from './features/doctrine/FormFieldReferenceFinder';
import { provideQueryBuilderCompletion } from './features/doctrine/queryBuilderCompletion';
import { QueryBuilderReferenceFinder, type QueryBuilderReference } from './features/doctrine/QueryBuilderReferenceFinder';
import { RepositoryReferenceFinder, type RepositoryReference } from './features/doctrine/RepositoryReferenceFinder';
import { EventNameReferenceFinder } from './features/events/EventNameReferenceFinder';
import { provideEventListenerImplementation } from './features/events/implementation';
import { provideMessageHandlerImplementation } from './features/messenger/implementation';
import { MessageClassReferenceFinder } from './features/messenger/MessageClassReferenceFinder';
import { provideRouteNameCompletion } from './features/routes/completion';
import { provideEntityPropertyCompletion, provideRoleCompletion, provideSecurityProviderCompletion } from './features/security/completion';
import { provideRoleHover } from './features/security/hover';
import { provideSecurityDefinition } from './features/security/definition';
import { provideSecurityDiagnostics } from './features/security/diagnostics';
import { provideRouteDefinition } from './features/routes/definition';
import { provideRouteDiagnostics } from './features/routes/diagnostics';
import { provideRouteHover } from './features/routes/hover';
import { provideRouteParameterCompletion } from './features/routes/parameterCompletion';
import { RouteReferenceFinder, type RouteReference } from './features/routes/RouteReferenceFinder';
import { AutowireReferenceFinder, type AutowireReferences } from './features/services/AutowireReferenceFinder';
import { provideParameterCompletion, provideServiceCompletion } from './features/services/completion';
import { provideEnvCompletion } from './features/services/envCompletion';
import { provideClassDefinition, provideParameterDefinition, provideServiceDefinition } from './features/services/definition';
import { provideServiceDiagnostics } from './features/services/diagnostics';
import { provideServiceHover } from './features/services/hover';
import { provideTemplateCompletion } from './features/templates/completion';
import { provideTemplateDefinition } from './features/templates/definition';
import { provideTemplateDiagnostics } from './features/templates/diagnostics';
import { TemplateReferenceFinder, type TemplateReference } from './features/templates/TemplateReferenceFinder';
import { provideTranslationCompletion } from './features/translations/completion';
import { provideTranslationDefinition } from './features/translations/definition';
import { provideTranslationDiagnostics } from './features/translations/diagnostics';
import { TranslationReferenceFinder, type TranslationReference } from './features/translations/TranslationReferenceFinder';
import { RouteIndex, routeFileKind } from './index/RouteIndex';
import { SERVICES_ENV, ServiceIndex, serviceFileKind } from './index/ServiceIndex';
import { EnvIndex } from './index/EnvIndex';
import { EventListenerIndex } from './index/EventListenerIndex';
import { MessageHandlerIndex } from './index/MessageHandlerIndex';
import { TranslationIndex } from './index/TranslationIndex';
import { DocumentTrees, languageOf } from './parsing/DocumentTrees';
import { bundledGrammarFiles, Parsers } from './parsing/parsers';
import { ProjectTemplates } from './project/ProjectTemplates';
import { SECURITY_ENV, SecurityConfig } from './project/SecurityConfig';
import { SymfonyProject } from './project/SymfonyProject';
import { MAIN_NAMESPACE } from './project/TwigLoaderPaths';
import type { EnvReference } from './services/envPlaceholders';
import type { ParameterReference } from './services/parameterPlaceholders';
import { findSecurityReferences, type SecurityReferences } from './security/securityYaml';
import { findYamlEnvReferences, findYamlParameterReferences, type YamlParameterScope } from './services/yamlParameterReferences';
import { findClassReferences, findServiceReferences, type ServiceReference } from './services/yamlServices';
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
  translations: TranslationIndex;
  doctrine: DoctrineEntities;
  env: EnvIndex;
  messageHandlers: MessageHandlerIndex;
  eventListeners: EventListenerIndex;
  security: SecurityConfig;
  reloadTimers: Map<string, NodeJS.Timeout>;
}

interface ParsingContext {
  parsers: Parsers;
  trees: DocumentTrees;
  templateReferences: TemplateReferenceFinder;
  routeReferences: RouteReferenceFinder;
  autowireReferences: AutowireReferenceFinder;
  translationReferences: TranslationReferenceFinder;
  repositoryReferences: RepositoryReferenceFinder;
  formFieldReferences: FormFieldReferenceFinder;
  queryBuilderReferences: QueryBuilderReferenceFinder;
  messageClassReferences: MessageClassReferenceFinder;
  eventNameReferences: EventNameReferenceFinder;
}

interface AnalyzedDocument {
  document: TextDocument;
  context: ProjectContext;
  templates: TemplateReference[];
  routes: RouteReference[];
  /** `#[Autowire]` references (PHP only). */
  autowire: AutowireReferences;
  translations: TranslationReference[];
  /** `->getRepository()` arguments (PHP only). */
  repositories: RepositoryReference[];
  /** `->add('field')` in form types (PHP only). */
  formFields: FormFieldReference[];
  /** DQL string literals of QueryBuilder calls (PHP only). */
  queryBuilder: QueryBuilderReference[];
}

interface AnalyzedServicesYaml {
  document: TextDocument;
  context: ProjectContext;
  references: ServiceReference[];
}

/** An open YAML file of the security configuration, with the references of its `security:` blocks. */
interface AnalyzedSecurityYaml {
  document: TextDocument;
  context: ProjectContext;
  references: SecurityReferences;
}

/** An open YAML configuration file (services, packages, routes) with its `%param%` placeholders. */
interface AnalyzedConfigYaml {
  document: TextDocument;
  context: ProjectContext;
  parameters: ParameterReference[];
  env: EnvReference[];
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
      autowireReferences: new AutowireReferenceFinder(parsers),
      translationReferences: new TranslationReferenceFinder(parsers),
      repositoryReferences: new RepositoryReferenceFinder(parsers),
      formFieldReferences: new FormFieldReferenceFinder(parsers),
      queryBuilderReferences: new QueryBuilderReferenceFinder(parsers),
      messageClassReferences: new MessageClassReferenceFinder(parsers),
      eventNameReferences: new EventNameReferenceFinder(parsers),
    };
  } catch (error) {
    connection.console.error(`[Parsers] Failed to load tree-sitter grammars: ${formatError(error)}`);
  }
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      implementationProvider: true,
      hoverProvider: true,
      completionProvider: { triggerCharacters: ["'", '"', '/', '@', '%', '.'] },
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
      const translations = buildTranslations(project);
      if (templates !== null && routes !== null && services !== null && translations !== null && parsing !== null) {
        const doctrine = new DoctrineEntities(project.root, parsing.parsers);
        const env = new EnvIndex(project.root);
        connection.console.info(`[EnvIndex] ${env.all().length} environment variables found in .env files`);
        const messageHandlers = new MessageHandlerIndex(project.root, parsing.parsers, services);
        connection.console.info(`[MessageHandlerIndex] ${messageHandlers.attributeHandlerCount()} #[AsMessageHandler] handlers found in src/`);
        const eventListeners = new EventListenerIndex(project.root, parsing.parsers, services);
        connection.console.info(`[EventListenerIndex] ${eventListeners.sourceListenerCount()} event listeners declared in src/`);
        const security = new SecurityConfig(project.root);
        connection.console.info(
          `[SecurityConfig] ${security.providers().length} user providers declared` +
            (security.isCertain() ? '' : ' (incomplete: unknown providers are not reported)'),
        );
        projects.push({ project, templates, routes, services, translations, doctrine, env, messageHandlers, eventListeners, security, reloadTimers: new Map() });
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
    const securityYaml = analyzeSecurityYaml(params.textDocument.uri);
    if (securityYaml) {
      const { document, context, references } = securityYaml;
      const location =
        provideRouteDefinition(document, params.position, references.routes, context.routes) ??
        provideSecurityDefinition(document, params.position, references, context.security, context.services, context.doctrine, openText);
      if (location) {
        return location;
      }
    }
    const configYaml = analyzeConfigYaml(params.textDocument.uri);
    const servicesYaml = analyzeServicesYaml(params.textDocument.uri);
    if (servicesYaml) {
      const { document, context, references } = servicesYaml;
      return (
        provideServiceDefinition(document, params.position, references, context.services) ??
        provideClassDefinition(document, params.position, findClassReferences(document.getText(), SERVICES_ENV), context.services) ??
        provideParameterDefinition(document, params.position, configYaml?.parameters ?? [], context.services)
      );
    }
    if (configYaml) {
      return provideParameterDefinition(configYaml.document, params.position, configYaml.parameters, configYaml.context.services);
    }
    const analyzed = analyze(params.textDocument.uri);
    if (!analyzed) {
      return null;
    }
    const { document, context } = analyzed;
    return (
      provideTemplateDefinition(document, params.position, analyzed.templates, context.templates.resolver) ??
      provideRouteDefinition(document, params.position, analyzed.routes, context.routes) ??
      provideTranslationDefinition(document, params.position, analyzed.translations, context.translations) ??
      provideRepositoryDefinition(document, params.position, analyzed.repositories, context.doctrine, openText) ??
      provideServiceDefinition(document, params.position, analyzed.autowire.services, context.services) ??
      provideParameterDefinition(document, params.position, analyzed.autowire.parameters, context.services)
    );
  } catch (error) {
    connection.console.error(`[Definition] ${formatError(error)}`);
    return null;
  }
});

connection.onImplementation((params) => {
  try {
    const document = documents.get(params.textDocument.uri);
    const context = document && projectFor(document.uri);
    if (!document || !context || !parsing || languageOf(document.uri) !== 'php') {
      return null;
    }
    const tree = parsing.trees.get(document);
    const classes = tree === null ? [] : parsing.messageClassReferences.find(tree.rootNode);
    const eventNames = tree === null ? [] : parsing.eventNameReferences.find(tree.rootNode);
    const locations = [
      ...(provideMessageHandlerImplementation(document, params.position, classes, context.messageHandlers, openText) ?? []),
      ...(provideEventListenerImplementation(document, params.position, classes, eventNames, context.eventListeners, openText) ?? []),
    ];
    return locations.length > 0 ? locations : null;
  } catch (error) {
    connection.console.error(`[Implementation] ${formatError(error)}`);
    return null;
  }
});

connection.onHover((params) => {
  try {
    const securityYaml = analyzeSecurityYaml(params.textDocument.uri);
    const securityHover =
      securityYaml &&
      (provideRouteHover(securityYaml.document, params.position, securityYaml.references.routes, securityYaml.context.routes, securityYaml.context.project.root) ??
        provideRoleHover(securityYaml.document, params.position, securityYaml.references.roles, securityYaml.context.security, securityYaml.context.project.root) ??
        provideServiceHover(securityYaml.document, params.position, securityYaml.references.services, securityYaml.context.services, securityYaml.context.project.root));
    if (securityHover) {
      return securityHover;
    }
    const servicesYaml = analyzeServicesYaml(params.textDocument.uri);
    if (servicesYaml) {
      const { document, context, references } = servicesYaml;
      return provideServiceHover(document, params.position, references, context.services, context.project.root);
    }
    const analyzed = analyze(params.textDocument.uri);
    if (!analyzed) {
      return null;
    }
    const { document, context } = analyzed;
    return (
      provideRouteHover(document, params.position, analyzed.routes, context.routes, context.project.root) ??
      provideServiceHover(document, params.position, analyzed.autowire.services, context.services, context.project.root)
    );
  } catch (error) {
    connection.console.error(`[Hover] ${formatError(error)}`);
    return null;
  }
});

connection.onCompletion((params) => {
  try {
    const configYaml = analyzeConfigYaml(params.textDocument.uri);
    if (configYaml) {
      const { document, context, parameters, env } = configYaml;
      const servicesYaml = analyzeServicesYaml(params.textDocument.uri);
      const securityYaml = analyzeSecurityYaml(params.textDocument.uri);
      const security = securityYaml?.references;
      return (
        (security && provideSecurityProviderCompletion(document, params.position, security, context.security.providers())) ??
        (security && provideEntityPropertyCompletion(document, params.position, security, context.doctrine, openText)) ??
        (security && provideServiceCompletion(document, params.position, security.services, context.services.visibleServices())) ??
        (security && provideRouteNameCompletion(document, params.position, security.routes, context.routes.visibleRoutes())) ??
        (security && provideRoleCompletion(document, params.position, security.roles, context.security)) ??
        (servicesYaml && provideServiceCompletion(document, params.position, servicesYaml.references, context.services.visibleServices())) ??
        provideEnvCompletion(document, params.position, env, context.env.all(), context.services.visibleParameters()) ??
        provideParameterCompletion(document, params.position, parameters, context.services.visibleParameters())
      );
    }
    const analyzed = analyze(params.textDocument.uri);
    if (!analyzed) {
      return null;
    }
    const { document, context } = analyzed;
    return (
      provideTemplateCompletion(document, params.position, analyzed.templates, context.templates.index.templates(), context.project.root) ??
      provideRouteNameCompletion(document, params.position, analyzed.routes, context.routes.visibleRoutes()) ??
      provideRouteParameterCompletion(document, params.position, analyzed.routes, context.routes) ??
      provideTranslationCompletion(document, params.position, analyzed.translations, context.translations) ??
      provideFormFieldCompletion(document, params.position, analyzed.formFields, context.doctrine, openText) ??
      provideQueryBuilderCompletion(document, params.position, analyzed.queryBuilder, context.doctrine, openText) ??
      provideServiceCompletion(document, params.position, analyzed.autowire.services, context.services.visibleServices()) ??
      provideEnvCompletion(document, params.position, analyzed.autowire.env, context.env.all(), context.services.visibleParameters()) ??
      provideParameterCompletion(document, params.position, analyzed.autowire.parameters, context.services.visibleParameters())
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
      if (EnvIndex.isEnvFile(file, context.project.root)) {
        scheduleReload(context, 'env', () => context.env.reload());
      }
      if (ProjectTemplates.isConfigFile(file, context.project.root)) {
        scheduleReload(context, 'templates', () => {
          const templates = buildTemplates(context.project);
          if (templates !== null) {
            context.templates = templates;
          }
        });
        scheduleReload(context, 'translator-config', () => {
          context.translations.reloadConfig();
          logTranslations(context.translations);
        });
      } else if (file.endsWith('.twig') && context.templates.index.refresh(file)) {
        touched.add(context);
      }
      if (!openDocumentFor(file) && context.translations.updateFile(file, null)) {
        touched.add(context);
      }
      if (!openDocumentFor(file) && context.security.updateFile(file, null)) {
        touched.add(context);
      } else if (/\.php$/i.test(file) && ProjectTemplates.isConfigFile(file, context.project.root)) {
        // A PHP configuration file makes the security configuration uncertain.
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
            context.doctrine.reloadAutoload();
            context.messageHandlers.reloadAutoload();
            context.eventListeners.reloadAutoload();
          });
          break;
        case 'source':
          // An open document is the source of truth for its file.
          if (!openDocumentFor(file) && context.routes.updatePhpFile(file, null)) {
            touched.add(context);
          }
          if (!openDocumentFor(file)) {
            context.messageHandlers.updatePhpFile(file, null);
            context.eventListeners.updatePhpFile(file, null);
          }
          break;
      }

      switch (serviceFileKind(file, context.project.root)) {
        case 'services-config':
          if (!openDocumentFor(file) && context.services.updateYamlFile(file, null)) {
            touched.add(context);
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
  if (context) {
    const file = uriToPath(uri);
    context.services.updateYamlFile(file, null);
    const securityChanged = context.security.updateFile(file, null);
    context.messageHandlers.updatePhpFile(file, null);
    context.eventListeners.updatePhpFile(file, null);
    const routesChanged = context.routes.updatePhpFile(file, null);
    const translationsChanged = context.translations.updateFile(file, null);
    if (routesChanged || translationsChanged || securityChanged) {
      revalidateProject(context);
    }
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
    autowire: language === 'php' ? parsing.autowireReferences.find(tree.rootNode) : { services: [], parameters: [], env: [] },
    translations: parsing.translationReferences.find(language, tree.rootNode),
    repositories: language === 'php' ? parsing.repositoryReferences.find(tree.rootNode) : [],
    formFields: language === 'php' ? parsing.formFieldReferences.find(tree.rootNode) : [],
    queryBuilder: language === 'php' ? parsing.queryBuilderReferences.find(tree.rootNode) : [],
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

/** An open YAML file of the security configuration, with the references of its `security:` blocks. */
function analyzeSecurityYaml(uri: string): AnalyzedSecurityYaml | null {
  const document = documents.get(uri);
  const context = document && projectFor(uri);
  if (!document || !context || !SecurityConfig.isConfigFile(uriToPath(uri), context.project.root)) {
    return null;
  }
  return { document, context, references: findSecurityReferences(document.getText(), SECURITY_ENV) };
}

function analyzeConfigYaml(uri: string): AnalyzedConfigYaml | null {
  const document = documents.get(uri);
  const context = document && projectFor(uri);
  const scope = context ? configYamlScope(uriToPath(uri), context.project.root) : null;
  if (!document || !context || scope === null) {
    return null;
  }
  const text = document.getText();
  return { document, context, parameters: findYamlParameterReferences(text, scope), env: findYamlEnvReferences(text, scope) };
}

/** Where container parameters are resolved in a YAML file of the project, if anywhere. */
function configYamlScope(file: string, projectRoot: string): YamlParameterScope | null {
  if (!/\.ya?ml$/i.test(file)) {
    return null;
  }
  const relative = path.relative(projectRoot, file).split(path.sep).join('/');
  if (serviceFileKind(file, projectRoot) === 'services-config' || /^config\/packages\/.+$/.test(relative)) {
    return 'all';
  }
  return routeFileKind(file, projectRoot) === 'routing-config' ? 'routes' : null;
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
    if (languageOf(uri) === 'php') {
      // No diagnostics depend on handlers or listeners: nothing to revalidate.
      context.messageHandlers.updatePhpFile(uriToPath(uri), document.getText());
      context.eventListeners.updatePhpFile(uriToPath(uri), document.getText());
    }
    if (context.services.updateYamlFile(uriToPath(uri), document.getText())) {
      revalidateProject(context, uri);
    }
    if (context.security.updateFile(uriToPath(uri), document.getText())) {
      revalidateProject(context, uri);
    }
    if (context.translations.updateFile(uriToPath(uri), document.getText())) {
      revalidateProject(context, uri);
    }
    publishDiagnostics(uri);
  } catch (error) {
    connection.console.error(`[Diagnostics] ${formatError(error)}`);
  }
}

function publishDiagnostics(uri: string): void {
  const securityYaml = analyzeSecurityYaml(uri);
  if (securityYaml) {
    const { document, context, references } = securityYaml;
    const servicesYaml = analyzeServicesYaml(uri);
    const diagnostics = [
      ...(servicesYaml ? provideServiceDiagnostics(document, servicesYaml.references, context.services) : []),
      ...provideSecurityDiagnostics(document, references, context.security, context.services),
      ...provideRouteDiagnostics(document, references.routes, context.routes),
    ];
    void connection.sendDiagnostics({ uri, version: document.version, diagnostics });
    return;
  }
  const analyzed = analyze(uri);
  if (!analyzed) {
    return;
  }
  const { document, context } = analyzed;
  const { resolver, loaderPaths } = context.templates;
  const diagnostics = [
    ...provideTemplateDiagnostics(document, analyzed.templates, resolver, (namespace) => loaderPaths.isCertain(namespace)),
    ...provideRouteDiagnostics(document, analyzed.routes, context.routes),
    ...provideServiceDiagnostics(document, analyzed.autowire.services, context.services),
    ...provideTranslationDiagnostics(document, analyzed.translations, context.translations),
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

function buildTranslations(project: SymfonyProject): TranslationIndex | null {
  if (parsing === null) {
    return null;
  }
  const translations = new TranslationIndex(project.root, parsing.parsers);
  logTranslations(translations);
  return translations;
}

function logTranslations(translations: TranslationIndex): void {
  for (const warning of translations.warnings) {
    connection.console.warn(`[TranslationIndex] ${warning}`);
  }
  connection.console.info(
    `[TranslationIndex] ${translations.size()} messages indexed (default locale: ${translations.defaultLocale})`,
  );
}

function registerFileWatchers(): void {
  if (!canWatchFiles) {
    connection.console.warn('[Server] Client cannot watch files: restart the server after adding templates, routes, services or translations');
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
    '**/translations/**/*.yaml',
    '**/translations/**/*.yml',
    '**/translations/**/*.xlf',
    '**/translations/**/*.xliff',
    '**/var/cache/dev/*Container.xml',
    '**/.env',
    '**/.env.*',
    '**/composer.json',
    '**/vendor/composer/installed.json',
  ];
  connection.client
    .register(DidChangeWatchedFilesNotification.type, { watchers: globs.map((globPattern) => ({ globPattern })) })
    .catch((error: unknown) => connection.console.error(`[Server] File watcher registration failed: ${formatError(error)}`));
}

/** Content of an open document, which takes precedence over the file on disk. */
function openText(file: string): string | null {
  return openDocumentFor(file)?.getText() ?? null;
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
