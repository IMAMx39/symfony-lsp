# symfony-zed

Extension Zed apportant les fonctionnalités du **Symfony Plugin de PhpStorm** (Haehnchen) :
navigation, complétion, hover et diagnostics Symfony dans PHP, Twig et YAML.

Motivation : l'extension Symfony officielle de Zed ne supporte pas Windows, et elle démarre
le kernel (PHP requis sur l'hôte). Ce projet vise Windows en priorité et fonctionne sans PHP local.

---

## Contexte développeur

- Développeur Symfony 7.x / PHP 8.2, Doctrine, Twig. Projets exécutés dans Docker.
- Machine de dev : **Windows** (Zed natif Windows). Doit aussi marcher sur macOS/Linux.
- Langue du code : anglais (identifiants, commentaires). Docs et messages de commit : français accepté.

---

## Architecture

```
symfony-zed/
├── extension.toml          # Manifeste Zed (id, version, language_servers)
├── Cargo.toml              # crate-type = ["cdylib"], dépendance zed_extension_api
├── src/
│   └── lib.rs              # Extension Rust → WASM : installe et lance le serveur LSP
├── server/                 # Serveur LSP TypeScript (toute la logique Symfony)
│   ├── package.json
│   ├── tsconfig.json
│   ├── scripts/build.mjs           # esbuild + copie des .wasm + imports ?raw
│   ├── src/
│   │   ├── server.ts               # Bootstrap LSP, câblage des handlers et watchers
│   │   ├── project/
│   │   │   ├── SymfonyProject.ts   # Détection projet, racine
│   │   │   ├── ComposerAutoload.ts # PSR-4 de composer.json + vendor/composer/installed.json
│   │   │   ├── bundles.ts          # Bundles activés (bundles.php), racine d'un bundle
│   │   │   ├── packageConfig.ts    # Lecture des YAML de config/packages (+ dev/, when@dev)
│   │   │   ├── TwigConfig.ts       # Lecture twig.yaml (default_path, paths, when@dev)
│   │   │   ├── TranslatorConfig.ts # framework.default_locale, translator.paths / default_path
│   │   │   ├── SecurityConfig.ts   # Providers déclarés sous security: (packages, services*.yaml), certitude
│   │   │   ├── TwigLoaderPaths.ts  # Dossiers par namespace, dans l'ordre de TwigBundle
│   │   │   ├── TemplateResolver.ts # Nom de template → fichier
│   │   │   ├── ProjectTemplates.ts # Regroupe chemins, résolveur et index d'un projet
│   │   │   ├── classLocation.ts    # Classe (ou méthode) → emplacement, via PSR-4
│   │   │   └── classSource.ts      # Déclaration d'une classe via PSR-4 (document ouvert prioritaire)
│   │   ├── routing/                # Extraction des routes : #[Route], YAML, cache compilé
│   │   ├── services/               # Container XML compilé, services et références `@id` du YAML
│   │   ├── translations/           # Noms de fichiers domaine.locale.format, messages YAML et XLIFF
│   │   ├── doctrine/               # DoctrineEntities : repositoryClass, champs mappés (à la demande via PSR-4)
│   │   ├── messenger/              # Handlers : #[AsMessageHandler], tags messenger.message_handler, type deviné
│   │   ├── events/                 # Listeners : #[AsEventListener], getSubscribedEvents(), règles de RegisterListenersPass
│   │   ├── security/               # Blocs security: du YAML : déclarations (providers, role_hierarchy), références
│   │   ├── index/
│   │   │   ├── TemplateIndex.ts
│   │   │   ├── EnvIndex.ts         # Variables des fichiers .env (ordre de Dotenv::loadEnv)
│   │   │   ├── RouteIndex.ts
│   │   │   ├── ServiceIndex.ts
│   │   │   ├── MessageHandlerIndex.ts  # Handlers de src/ + tags du container/YAML, hiérarchie du message
│   │   │   ├── EventListenerIndex.ts   # Listeners de src/ + appels addListener du container dumpé, alias
│   │   │   └── TranslationIndex.ts
│   │   ├── parsing/
│   │   │   ├── parsers.ts          # Init web-tree-sitter (PHP, Twig)
│   │   │   ├── DocumentTrees.ts    # Arbres des documents ouverts (cache par version)
│   │   │   ├── literals.ts / phpValues.ts / phpNames.ts  # Littéraux, valeurs, noms de classes
│   │   │   ├── phpDeclarations.ts  # Classe déclarée, supertypes, méthode, attributs résolus
│   │   │   └── queries/            # Requêtes tree-sitter (.scm)
│   │   ├── features/               # Un dossier par fonctionnalité
│   │   │   ├── templates/          # definition, completion, diagnostics
│   │   │   ├── routes/             # definition, completion, hover, paramètres, diagnostics
│   │   │   ├── services/           # definition, completion, hover, diagnostics (YAML, #[Autowire])
│   │   │   ├── translations/       # definition, completion, diagnostics (trans(), |trans, {% trans %})
│   │   │   ├── doctrine/           # definition (getRepository), completion des champs (form types, QueryBuilder)
│   │   │   ├── messenger/          # implementation : message → handlers
│   │   │   ├── events/             # implementation : événement → listeners et subscribers
│   │   │   └── security/           # security.yaml (definition, completion, hover, diagnostics), rôles en PHP/Twig
│   │   └── util/
│   │       ├── paths.ts            # Normalisation chemins/URI cross-platform
│   │       └── phpFiles.ts         # Fichiers .php d'un dossier (vendor/, var/… ignorés)
│   └── tests/
│       ├── fixtures/symfony-app/   # Mini projet Symfony réaliste
│       ├── features/               # Tests par fonctionnalité
│       ├── index/ project/ routing/ security/ services/ translations/ util/
└── CLAUDE.md
```

**Règle de séparation** : `lib.rs` ne contient aucune logique Symfony. Il résout le chemin du
serveur, lance Node et transmet les options. Tout le reste vit dans `server/`.

---

## Stack

- Extension : Rust stable via rustup, crate `zed_extension_api` 0.7.x, cible `wasm32-wasip2` gérée par Zed.
- Serveur : Node 20+, TypeScript 7 (`strict: true`, `noUncheckedIndexedAccess`), bundle CommonJS
  (pas de `"type": "module"` dans `package.json`, sinon `dist/server.js` serait lu comme ESM).
  - `vscode-languageserver` + `vscode-languageserver-textdocument` : protocole LSP
  - `vscode-uri` : conversion chemin ⇄ URI (obligatoire, jamais à la main)
  - `web-tree-sitter` + grammaires WASM PHP et Twig : parsing tolérant aux fichiers incomplets
    - **Épinglé en `0.25.10`** : `tree-sitter-twig` 0.8.2 publie un WASM ABI 14 que
      `web-tree-sitter` ≥ 0.26 refuse de charger. Ne monter qu'avec un WASM Twig compatible.
    - Grammaires : devDependencies `tree-sitter-php` et `tree-sitter-twig` (versions exactes),
      dont seuls les `.wasm` servent. `server/.npmrc` met `ignore-scripts=true` : leurs scripts
      d'installation compilent un binding natif (node-gyp + Visual Studio) inutile ici.
    - Les index tree-sitter (`startIndex`) sont en unités UTF-16 : convertir via
      `TextDocument.positionAt()`, jamais à partir de `startPosition`.
    - Les arbres vivent dans le tas WASM : appeler `tree.delete()` quand on les remplace.
  - `yaml` : lecture des fichiers de config et traductions YAML
  - `fast-xml-parser` : lecture du container compilé
  - `esbuild` : bundle `dist/server.js` via `scripts/build.mjs`, qui copie aussi les 3 `.wasm`
    dans `dist/`, force la build CommonJS de `web-tree-sitter` et gère les imports `?raw`
    (requêtes `.scm` inlinées, même convention que Vite dans les tests)
  - `vitest` : tests

**Ne pas ajouter d'autre dépendance sans me demander.**

---

## Principes non négociables

1. **Jamais de PHP sur l'hôte, jamais de boot du kernel.** Les projets tournent dans Docker.
   Les données viennent uniquement des fichiers du projet et du cache compilé dans `var/`.
2. **Mieux vaut ne rien répondre que répondre faux.** En cas d'ambiguïté (chaîne dynamique,
   concaténation, variable), ne pas proposer de définition ni de diagnostic.
3. **Dégradation gracieuse.** Si `var/cache/dev` est absent, les fonctions basées sur le
   container sont désactivées sans erreur ; les fonctions basées sur les sources continuent.
4. **Performance.** Indexation initiale en arrière-plan, puis mise à jour incrémentale via
   `workspace/didChangeWatchedFiles` et `textDocument/didChange`. Ignorer `vendor/` sauf pour
   les templates de bundles, et ignorer toujours `var/` (hors lecture ciblée du cache), `node_modules/`, `public/`.
5. **Les fichiers ouverts priment sur le disque** : utiliser le contenu du `TextDocuments` si le fichier est ouvert.

---

## Sources de données Symfony

| Donnée | Source |
|---|---|
| Racine projet | Dossier contenant `composer.json` + `bin/console` (ou `config/bundles.php`) ; le dossier de workspace d'abord, sinon un **unique** sous-dossier direct (hors `vendor/`, `var/`, `node_modules/`, `public/`) |
| Templates | `twig.default_path` et `twig.paths` (YAML de `config/packages/` puis `config/packages/dev/`, chacun suivi de son bloc `when@dev` ; les configs PHP ne sont pas lues), templates des bundles activés en `dev` dans `config/bundles.php`, vues de twig-bridge |
| Classes des bundles | PSR-4 de `composer.json` et `vendor/composer/installed.json` ; racine du bundle déduite de la classe (`Bundle` → dossier de la classe, `AbstractBundle` → parent, ou `getPath()` littéral `__DIR__` / `dirname(__DIR__[, n])`) ; sinon bundle ignoré |
| Overrides de bundles | `<default_path>/bundles/<NomBundle>/...` (prioritaires sur le bundle) |
| Services | `var/cache/dev/App_KernelDevDebugContainer.xml` (glob `*Container.xml`, le plus récent gagne), puis clés explicites de `config/services.yaml` et `config/services_dev.yaml` |
| Routes | Attributs `#[Route]` dans `src/Controller/**`, fichiers `config/routes/*.yaml`, et `var/cache/dev/url_generating_routes.php` si présent |
| Variables d'environnement | `.env` (ou `.env.dist`), `.env.local` (sauf `test`), `.env.<APP_ENV>`, `.env.<APP_ENV>.local` à la racine, `APP_ENV` lu dans ces fichiers (défaut `dev`) ; plus les `env(NOM)` de `parameters:` / du container. Ni `.env.local.php` ni l'environnement Docker |
| Traductions | Dossiers `translator.paths` puis `translator.default_path` (défaut `translations/`), récursivement : fichiers `domaine.locale.{yaml,yml,xlf,xliff}` ; locale par défaut `framework.default_locale` (défaut `en`) |
| Entités Doctrine | Attribut `#[ORM\Entity]` de la classe, lu à la demande dans le fichier trouvé via PSR-4 (pas d'index) |
| Handlers Messenger | `#[AsMessageHandler]` de `src/**/*.php`, plus les tags `messenger.message_handler` du container dumpé et de `config/services*.yaml` ; message deviné en lisant la classe du handler via PSR-4 (vendor compris) |
| Configuration de sécurité | Blocs `security:` (racine et `when@dev`) des YAML de `config/packages/`, `config/packages/dev/`, `config/services.yaml` et `config/services_dev.yaml` ; les configs PHP ne sont pas lues |
| Listeners d'événements | `#[AsEventListener]` et subscribers de `src/**/*.php` (+ tags non issus d'attributs pour ces classes) ; hors `src/`, appels `addListener` des dispatchers du container dumpé ; alias depuis le paramètre `event_dispatcher.event_aliases` du dump |

### Résolution des noms de templates

Ordre vérifié dans le code de TwigBundle 7.4 (`TwigExtension::load`, `getBundleTemplatePaths`,
`Compiler\ExtensionPass`), implémenté dans `TwigLoaderPaths`. Chaque namespace reçoit ses dossiers
dans cet ordre, et le premier fichier existant gagne :
1. `twig.paths`, dans l'ordre de la config (sans namespace → namespace principal).
   **Ils passent donc avant `templates/`.**
2. Pour chaque bundle activé, dans l'ordre de `bundles.php` : `<default_path>/bundles/<Nom>Bundle`,
   puis `Resources/views` ou `templates` du bundle. Namespace = nom sans le suffixe `Bundle`.
   `@!Nom` reçoit le dernier de ces dossiers (donc le bundle, sans l'override).
3. `default_path` (par défaut `templates/`) dans le namespace principal.
4. twig-bridge : `@email` si `symfony/mailer` est installé, form themes (`form_div_layout.html.twig`…)
   dans le namespace principal si `symfony/form` est installé.

Autres règles :
- Un bundle dont on ne sait pas localiser les templates laisse son namespace inconnu (pas de
  résolution partielle via le seul override).
- Environnement reproduit : `dev`. La config est relue quand `config/packages/**`,
  `config/bundles.php`, `composer.json` ou `vendor/composer/installed.json` change (watchers LSP).

### Complétion et diagnostics de templates

- `TemplateIndex` liste les `.twig` de chaque namespace (premier dossier gagnant, comme Twig).
  Les sous-dossiers enregistrés pour un autre namespace (overrides `templates/bundles/…`) ne sont
  pas listés sous le namespace parent. Un `.twig` créé/supprimé ne rescanne que les namespaces
  concernés.
- Complétion : curseur entre les guillemets d'un littéral en position de template ; remplace tout
  le contenu du littéral. Les noms `@!Ns/` ne sont proposés qu'une fois `@!` tapé.
- Diagnostic « template introuvable » (Warning, code `template-not-found`) seulement si :
  le nom finit par `.twig` ; pas de `ignore missing` (tag) ni d'argument `ignore_missing`
  (`include()`, `source()`) ; pour un tableau, aucun élément n'existe et tous sont littéraux ;
  `TwigLoaderPaths.isCertain(namespace)`, faux si une config Twig PHP existe, si un YAML est
  illisible, si `vendor/composer/installed.json` manque, ou si un chemin du namespace contient un
  paramètre non résolu.
- La résolution est **sensible à la casse sur toutes les plateformes** : le projet tourne dans un
  conteneur Linux, où `Home/index.html.twig` ne trouve pas `home/index.html.twig`.
- Seules les chaînes littérales comptent : `'...'` sans `\`, ou `"..."` sans interpolation ni
  échappement. Concaténation, variable ou argument nommé : aucune réponse.

### Routes

`RouteIndex` fusionne, de la priorité la plus basse à la plus haute :
1. le cache `var/cache/dev/url_generating_routes.php` (noms, chemins, `_controller`, alias compris)
   et `url_matching_routes.php` (méthodes HTTP) : seule source des routes de bundles et des loaders
   de service (`routing.controllers`, `security.route_loader.logout`), mais potentiellement périmé ;
2. les routes YAML de `config/routes/dev/*.yaml`, `config/routes/*.yaml`, `config/routes.yaml`
   (+ `when@dev`), alias `name: { alias: x }` compris ;
3. les `#[Route]` de `src/**/*.php`, avec `prefix` / `name_prefix` de l'import YAML de dossier qui
   couvre le fichier. Un document ouvert remplace le contenu disque de son fichier.

Règles du loader reproduites (vérifiées dans `AttributeClassLoader` et
`AttributeRouteControllerLoader` 7.4) : préfixes de nom/chemin et `methods` du `#[Route]` de classe,
`env`, plusieurs routes par méthode, nom par défaut (`app_blog_feed` pour
`App\Controller\BlogController::feedAction`, suffixe `_1`, `_2`…), classe invokable sans route de
méthode, alias `Classe::méthode` / FQCN. Les alias sont résolus mais pas proposés en complétion.

Positions reconnues : premier argument littéral de `path()`, `url()` (Twig), `->redirectToRoute()`,
`->generateUrl()` (PHP). Pas `->generate()` (trop générique). Définition : attribut ou clé YAML,
sinon méthode du contrôleur via PSR-4 (contrôleur en id de service : rien avant la phase 3).

Complétion des paramètres : variables du chemin non utilisées, en position de clé seulement.
Diagnostic « route inconnue » (Warning, code `route-not-found`) seulement si
`RouteIndex.isCertain()` : cache compilé présent, aucun YAML illisible / import glob / import YAML
imbriqué / chemin localisé, aucun `#[Route]` à nom non littéral, aucune config de routes en PHP.
Limite connue : une route supprimée des sources mais encore dans un cache périmé reste « connue ».

### Services

`ServiceIndex` fusionne, de la priorité la plus basse à la plus haute :
1. le container dumpé en debug (`var/cache/dev/*Container.xml`) : seuls les `<service>` directement
   sous `<services>` (id, `class`, `alias`), les services inline imbriqués sont ignorés. Il couvre
   les bundles et les classes enregistrées par `resource:`, mais peut être périmé, et ne contient
   pas les services privés retirés à la compilation ;
2. les clés explicites sous `services:` (+ `when@dev`) de `config/services.yaml` puis
   `config/services_dev.yaml` (fichiers chargés par `MicroKernelTrait`). Exclus : `_defaults`,
   `_instanceof`, prototypes `resource:`. Classe : `class:`, sinon l'id s'il est un nom de classe à
   namespace (comme `ResolveClassPass`), inconnue pour une définition `parent:` (prise du container).
   Un document ouvert remplace son fichier ; un YAML invalide garde les déclarations précédentes.

Références reconnues : littéraux quotés `'@id'`, `'@?id'`, `'@!id'` (sans échappement) là où
`YamlFileLoader` résout des références : syntaxe courte `foo: '@bar'` et valeurs de `arguments`,
`properties`, `calls`, `configurator`, `factory`, `bind` (y compris `_defaults` et `_instanceof`).
Exclus : `@@` (échappement), `@=` (expression), tags, `parameters:`, autres `when@`.
Complétion : ids sans ceux commençant par `.` (comme `debug:container`), remplace l'id en gardant
le préfixe. Définition : clé YAML de la déclaration, sinon classe via PSR-4 en suivant les alias.
Définition de classe dans ces YAML : clé de service qui est un nom de classe à namespace, valeur de
`class:`, clés de `_instanceof` → déclaration (classe, interface, trait ou enum) via PSR-4. Les
prototypes `App\:` (namespace) et les ids sans namespace ne mènent nulle part.
Survol (mêmes positions, YAML et `#[Autowire]`) : cible finale de la chaîne d'alias, sa classe,
ses tags (union du container, autoconfiguration comprise, et du YAML ; un `<tag>` dont le nom est
en texte compte aussi), ses autres alias directs visibles, et l'emplacement de la déclaration.

Paramètres : `<parameters>` du container (valeur résolue, collections sans valeur) et clés de
`parameters:` des mêmes YAML (emplacement de la déclaration). Ceux commençant par `.` ne sont pas
proposés. Définition : clé YAML seulement (un paramètre connu du seul container n'a pas de cible).

Placeholders `%nom%` dans le YAML (`services/yamlParameterReferences.ts`) : toutes les valeurs (pas les
clés) de `config/services*.yaml` et `config/packages/**/*.yaml` ; dans `config/routes*.yaml` et
`config/routes/**`, seulement sous les clés que `Router::resolveParameters()` résout (`path`, `host`,
`defaults`, `requirements`, `schemes`, `methods`, `condition`) ou qui en deviennent (`controller`,
`locale`, `format`, `prefix`), pour chaque route et dans les blocs `when@*`. Seuls les scalaires dont le
texte source est la valeur sont lus (simple, entre guillemets sans échappement ni `''`, sur une ligne) ;
blocs `|` / `>` ignorés. `%%` échappé, `%env(...)%` traité à part. Définition et complétion
partagées avec `#[Autowire]` (la complétion d'un `%nom` non fermé ajoute le `%`).

`%env(...)%` (mêmes valeurs YAML, valeur de `#[Autowire]`, et `#[Autowire(env: '...')]`) : complétion seule,
par segment de `processeur:...:NOM`. Dernier segment : variables (`EnvIndex`, puis `env(NOM)` des
paramètres) et processeurs ; segments précédents : processeurs (liste de
`EnvVarProcessor::getProvidedTypes()` 7.4) ; l'argument qui suit `default`, `key` ou `enum` n'est pas
complété. Une variable complète la fermeture manquante (`)%`, ou `%` après une `)` existante). Les `.env*`
sont relus via le watcher (Zed ne les synchronise pas : pas de document ouvert).

`#[Autowire]` en PHP : uniquement si le nom de l'attribut se résout (via les `use`) en
`Symfony\Component\DependencyInjection\Attribute\Autowire`. Arguments nommés ou positionnels
(`value`, `service`, `expression`, `env`, `param`, `lazy`) :
- `service: 'id'` et valeur `'@id'` → service (`@@` et `@=` exclus, pas de `@?` ici, comme
  `Autowire::__construct()`) ;
- `param: 'nom'` et placeholders `%nom%` de la valeur (`%%` = `%` échappé, nom sans espace) →
  paramètre. `%env(...)%` n'a pas de définition. La complétion d'un `%nom` non fermé ajoute le `%`.
- `expression`, `env` et valeurs non littérales : aucune réponse.

Diagnostic « service inconnu » (Warning, code `service-not-found`) seulement si
`ServiceIndex.isCertain()` : container dumpé présent et plus récent que `config/packages/**`,
`config/bundles.php`, `composer.json` et `vendor/composer/installed.json` ; `config/services.yaml`
existe (sinon `services.php` est chargé) ; YAML de services valides et sans `imports:` (racine ou
`when@dev`). Et seulement pour une référence obligatoire : pas `@?id` / `@!id`, pas un `#[Autowire]`
sur un paramètre non typé, nullable (`?T`, `T|null`, `mixed`) ou avec valeur par défaut (prudence :
`allowsNull()`), pas un id à namespace dont la classe existe via PSR-4 (peut-être enregistrée par
`resource:` depuis le dernier dump). Limite connue : un service supprimé des sources mais encore
dans un dump récent reste « connu ».

### Traductions

Vérifié dans FrameworkBundle / Translation / TwigBridge 7.4 (`FrameworkExtension::registerTranslatorConfiguration`,
`Translator`, `YamlFileLoader`, `ArrayLoader`, `XliffFileLoader`, `TransNode`, `TranslationDefaultDomainNodeVisitor`).

`TranslationIndex` lit les dossiers du projet dans l'ordre de `FrameworkExtension` : `translator.paths`, puis
`default_path` (le suivant l'emporte). Les dossiers des composants et des bundles ne sont **pas** parsés (seuls
leurs noms de fichiers comptent, voir le diagnostic). Config lue
comme pour Twig (YAML de `config/packages/` puis `dev/`, chacun suivi de `when@dev` ; `framework.php` et
`translation.php` signalés, non lus ; `translator: false` / `enabled: false` → aucun dossier).
- Nom de fichier : `domaine.locale.format`, domaine pouvant contenir des points, au moins deux points ;
  suffixe `+intl-icu` retiré du domaine. Formats lus : YAML et XLIFF ; les autres (php, json, csv…) sont ignorés.
- YAML : clés imbriquées jointes par `.`, valeurs `null` ignorées, séquences ignorées (pas de nœud de clé).
- XLIFF 1.2 : clé = `resname` non vide, sinon `<source>` ; XLIFF 2.0 : clé = `name` de l'`<unit>`, sinon
  `<source>` du `<segment>`. Commentaires ignorés, entités et CDATA décodés, source contenant du balisage ignorée.
  Emplacements trouvés par analyse du texte (fast-xml-parser ne fournit pas de positions, il sert à valider).
- Un document ouvert remplace son fichier ; un contenu invalide garde les messages précédents.

Positions reconnues : premier argument littéral de `->trans()` (PHP, quel que soit l'objet ; `id:` nommé
accepté), objet littéral du filtre `|trans`, corps texte de `{% trans %}…{% endtrans %}` (clé = corps
`trim()` avec `%%` → `%`, comme `TransNode`). Pas `t()` ni `TranslatableMessage`.
Domaine : argument littéral (`domain:` nommé, 3ᵉ positionnel en PHP, 2ᵉ en Twig, `from` du tag ; `null` →
`messages`), sinon `{% trans_default_domain %}`, sinon `messages`. `trans_default_domain` n'est suivi que s'il
est unique, littéral, au niveau racine du template, et pour les nœuds situés après lui hors `{% embed %}` ;
sinon domaine inconnu → aucune réponse. Domaine non littéral, dépaquetage `...$args` : aucune réponse.
Définition : la clé dans chaque fichier qui la définit, locale par défaut d'abord, puis par priorité.
Complétion : clés du domaine (toutes locales), valeur de la locale par défaut en détail ; les clés qui
demanderaient un échappement (guillemet, `\`, interpolation, `%%` ou délimiteur Twig dans un tag) sont omises.
Watchers : `**/translations/**/*.{yaml,yml,xlf,xliff}` (un `translator.paths` hors d'un dossier `translations/`
n'est pas surveillé).

Diagnostic « traduction introuvable » (Warning, code `translation-not-found`) : clé littérale absente de la
locale par défaut et de ses parents (`fr` pour `fr_FR`), seulement si `TranslationIndex.isCertain(domaine)` :
- config du traducteur entièrement lue (pas de `framework.php` / `translation.php`, YAML de `config/packages`
  valides, chemins résolus) ;
- `vendor/composer/installed.json` présent et chaque bundle activé localisé ; aucun fichier `domaine.<locale>.*`
  du catalogue dans les dossiers que `FrameworkExtension` scanne aussi (`Resources/translations` de
  symfony/validator, form, security-core ; `Resources/translations` ou `translations` des bundles) ;
- dans le projet : au moins un fichier du domaine pour la locale par défaut (sinon les clés sont sans doute le
  texte source), tous valides, et aucun dans un format non lu (php, json…).
Domaine inconnu, clé vide ou dynamique : aucun diagnostic. Un fichier de traduction modifié (disque ou document
ouvert) revalide les documents du projet ; `bundles.php`, `composer.json` et `installed.json` rechargent la config.

### Doctrine

`->getRepository(X)` (quel que soit l'objet ; argument positionnel, `className:` d'`ObjectManager` ou
`persistentObject:` de `ManagerRegistry`) avec `X` = `Foo::class` résolu via les `use` du document, ou chaîne
littérale (toujours un FQCN ; en simples guillemets seuls `\\` et `\'` sont des échappements).
Définition : le fichier de l'entité est trouvé via PSR-4 (document ouvert prioritaire), l'attribut doit se
résoudre en `Doctrine\ORM\Mapping\Entity` ; `repositoryClass` nommé ou 1ᵉʳ positionnel, `::class` résolu via
les `use` du fichier de l'entité ou chaîne → déclaration de la classe via PSR-4. Sans `repositoryClass`
(repository par défaut ou factory configurés ailleurs), `static::class`, variable, concaténation : aucune réponse.
Mappings XML/YAML non lus.

Champs d'une entité (`DoctrineEntities.fields`) : propriétés (et paramètres promus) portant `Column`, `ManyToOne`,
`OneToOne`, `OneToMany`, `ManyToMany` ou `Embedded`, plus celles des parents `#[Entity]` / `#[MappedSuperclass]`
(un parent non mappé est ignoré, comme Doctrine) et des traits utilisés. Classe non mappée (`Entity`,
`MappedSuperclass`, `Embeddable`) : `null`. Cible : `targetEntity` / `class` littéral (nommé ou 1ᵉʳ positionnel),
sinon type de la propriété pour `ManyToOne`, `OneToOne` et `Embedded` (inférence de Doctrine).
Form types : complétion des champs mappés de `data_class` dans le 1ᵉʳ argument littéral de `->add()` (ou `child:`)
au sein de `buildForm()`. `data_class` vient de `configureOptions()` : `setDefaults([... 'data_class' => X ...])`
ou `setDefault('data_class', X)`, `X` littéral ; absent, dynamique, plusieurs valeurs, ou classe non mappée :
aucune réponse (pas de champs de DTO).

QueryBuilder : complétion après `alias.` (et `alias.embedded.` pour un `Embedded`) dans les chaînes littérales
(ou tableaux de chaînes) de `select`, `addSelect`, `where`, `andWhere`, `orWhere`, `having`, `andHaving`,
`orHaving`, `orderBy`, `addOrderBy`, `groupBy`, `addGroupBy`, `join`, `innerJoin`, `leftJoin`, `set`, `indexBy`.
L'appel doit appartenir à une chaîne contenant `createQueryBuilder()`, ou à une variable affectée **une seule
fois** depuis une telle chaîne dans la même fonction (réaffectations `$qb = $qb->...` permises, toute autre
affectation → aucune réponse). Alias : `$this->createQueryBuilder('a')` (entité du repository, lue dans
`parent::__construct($registry, X::class)` de son constructeur), `->from(X, 'a')`, `->join('a.assoc', 'b')`
(cible de l'association) ou `->join(X::class, 'b', ...)`. Alias déclaré deux fois différemment, alias inconnu,
paramètre `:x`, chemin au-delà d'une association, chaîne dynamique : aucune réponse. `.` est un caractère
déclencheur de complétion.
Définition dans ces mêmes chaînes (`features/doctrine/dqlPaths.ts`) : un segment de `alias.champ` (ou
`alias.embedded.champ`) mène à la propriété mappée (parents et traits compris), un alias à la classe de son entité.
Chemins reconnus : identifiants séparés par `.`, hors paramètres (`:x`, `?1`), noms de classe (`\`) et variables.

Options des associations (`MappingReferenceFinder`, constructeurs vérifiés dans Doctrine ORM 3.6) : littéraux
`mappedBy`, `inversedBy` et `indexBy` de `ManyToOne`, `OneToOne`, `OneToMany`, `ManyToMany` (nom résolu via les `use`),
nommés ou positionnels (`ManyToOne` : `inversedBy` 4ᵉ ; `OneToOne` : `mappedBy` 2ᵉ, `inversedBy` 3ᵉ ; `OneToMany` :
`mappedBy` 2ᵉ, `indexBy` 6ᵉ ; `ManyToMany` : `mappedBy` 2ᵉ, `inversedBy` 3ᵉ, `indexBy` 7ᵉ). Cible : `targetEntity`
(`::class` ou chaîne), sinon type de la propriété pour un to-one ; sans cible, aucune réponse. Définition : propriété de
la cible. Complétion : associations de la cible (`mappedBy` / `inversedBy`), colonnes (`indexBy`). Pas de diagnostic.

Coloration du DQL (`dqlSemanticTokens.ts`, `textDocument/semanticTokens/full`, PHP seulement) dans les chaînes du
QueryBuilder (mêmes méthodes, plus `from` pour son alias) : alias connu → `variable`, champ résolu après un alias
(`resolveDqlField`) → `property` (un champ inconnu reste non coloré), `:nom` / `?1` → `parameter`, mot réservé DQL
(insensible à la casse) → `keyword`, identifiant suivi de `(` → `function`. Les chaînes DQL (`'...'`) sont ignorées.
Demande `"semantic_tokens": "combined"` dans les settings Zed (voir « Tester dans Zed »).


### Messenger

Vérifié dans Messenger / FrameworkBundle 7.4 (`MessengerPass::registerHandlers()` et `guessHandledClasses()`,
`HandlersLocator::listTypes()`, `registerAttributeForAutoconfiguration(AsMessageHandler::class)`).

`MessageHandlerIndex` réunit :
1. les `#[AsMessageHandler]` (nom résolu via les `use`, répétable) des classes concrètes de `src/**/*.php` : sur la
   classe (méthode `method:` ou `__invoke`) ou sur une méthode (cette méthode ; un `method:` y est refusé comme
   FrameworkBundle). Classe abstraite (exclue par `registerClasses`), `handles` / `method` non littéraux : ignorés.
   Un document ouvert remplace son fichier ;
2. les tags `messenger.message_handler` des services (`ServiceIndex.taggedWith()` : container dumpé + YAML, attributs
   des tags compris). Classe lue via PSR-4, vendor compris (handlers de Mailer, Notifier, bundles…). Si un service a des
   tags avec attributs, ses tags sans attribut sont ignorés (`array_filter`). Pour une classe de `src/`, les tags du dump
   portant tous les attributs d'`AsMessageHandler` (`bus`, `from_transport`, `handles`, `method`, `priority`, `sign`)
   sont ignorés : les sources, plus récentes, font foi.

Message traité : `handles` s'il est donné, sinon le type du 1ᵉʳ paramètre de la méthode (`?Foo` → `Foo`, chaque classe
d'une union). Méthode non déclarée dans la classe elle-même, paramètre absent, optionnel, variadique, non typé,
scalaire ou intersection : aucun handler (pas de supposition).
Handlers d'une classe message : ceux de la classe, de ses parents puis de toutes ses interfaces (via PSR-4, document
ouvert prioritaire), dans l'ordre de `HandlersLocator` (priorité décroissante au sein d'un type), une fois chacun par
`Classe::méthode`. Les handlers de `*` sont omis (ils ne disent rien de la classe) ; les jokers `App\Message\*` ne sont
pas acceptés par `MessengerPass`.
Les bus et `from_transport` ne filtrent pas la liste.

Position : `textDocument/implementation` sur un nom de classe PHP (déclaration de classe ou d'interface,
`new X()`, `X::class`, type de paramètre ou de propriété), curseur sur le nom ou juste après. Cible : le nom de la
méthode du handler (le nom de la classe si la méthode est héritée). Aucun handler : `null`, pour laisser répondre
les autres serveurs. Limite connue : un handler supprimé hors `src/` mais encore dans un dump périmé reste listé.

### Event Dispatcher

Vérifié dans EventDispatcher / FrameworkBundle 7.4 (`RegisterListenersPass`, `ExtractingEventDispatcher`,
`EventDispatcher::addSubscriber()`, `AsEventListener`, `registerAttributeForAutoconfiguration(AsEventListener::class)`,
`registerForAutoconfiguration(EventSubscriberInterface::class)`, `AddEventAliasesPass`).

`EventListenerIndex` réunit :
1. les sources de `src/**/*.php` (un document ouvert remplace son fichier), classes concrètes seulement :
   - `#[AsEventListener]` (nom résolu via les `use`, répétable) sur la classe ou sur une méthode (cette méthode ; un
     `method:` y est refusé comme FrameworkBundle). `event` / `method` non littéraux : attribut ignoré ;
   - `getSubscribedEvents()` des classes qui déclarent elles-mêmes `implements EventSubscriberInterface` : méthode
     déclarée dans la classe, corps à un unique `return [...]` (pas de `yield`). Valeurs `'m'`, `['m', prio]`,
     `[['m', prio], …]` ; entrées non littérales ou `...` ignorées ;
   - les tags `kernel.event_listener` / `kernel.event_subscriber` des services de ces classes (`ServiceIndex.taggedWith()`),
     sauf les tags d'attribut du dump (`event`, `method`, `priority`, `dispatcher` tous présents) : les sources font foi ;
2. pour les classes hors `src/` (vendor, bundles) : les `<call method="addListener">` de tous les services du container
   dumpé (dispatcher global et dispatchers de firewall), où l'événement, la méthode et la priorité sont déjà résolus.
   Les appels visant une classe de `src/` sont ignorés (dump potentiellement périmé).

Noms d'événements : chaîne littérale, `Foo::class`, ou `Foo::CONSTANTE` / `self::CONSTANTE` lue via PSR-4 (constante
déclarée par la classe elle-même, valeur littérale ou `::class`) ; `static::` et `parent::` ne sont pas suivis.
Les constantes sont lues à la demande (pas figées dans l'index). Alias : `event_dispatcher.event_aliases` du dump
(classe → nom), appliqués aux listeners comme aux subscribers ; sans dump, aucun alias.
Règles de `RegisterListenersPass` :
- sans `event` : tag ignoré si la classe est aussi un subscriber, sinon `method` (défaut `__invoke`) déclarée dans la
  classe, événements = classes du type du 1ᵉʳ paramètre (classe, `?Foo`, membres classes d'une union ; types natifs et
  `Symfony\Contracts\EventDispatcher\Event` exclus ; intersection ou aucun : ignoré) ;
- sans `method` : `on` + nom d'événement (alias appliqué) en camel case (`onKernelRequest`) si la classe la déclare,
  sinon `__invoke` ; si la classe a un parent ou utilise un trait, la méthode pourrait être héritée : ignoré.
Résultat : listeners de l'événement (nom après alias), une fois chacun par `Classe::méthode`, priorité décroissante.
Pas de hiérarchie (le dispatcher n'utilise que le nom exact). Cible : nom de la méthode, ou de la classe si la
méthode n'est pas déclarée par la classe elle-même.

Positions de `textDocument/implementation` (PHP) : noms de classes (mêmes positions que Messenger : déclaration,
`new X()`, `X::class`, type), `Foo::CONSTANTE` partout, littéraux en position d'événement : 2ᵉ argument de
`->dispatch()` (ou `eventName:`), `event` d'`#[AsEventListener]`, clés du `return [...]` de `getSubscribedEvents()`.
Sur une classe, la réponse réunit handlers Messenger et listeners. Aucun résultat : `null`.
Limites connues : sans container dumpé, ni listeners du vendor ni alias ; un subscriber dont `getSubscribedEvents()`
est hérité ou calculé n'est pas lu.

### Sécurité

Vérifié dans SecurityBundle 7.4 (`MainConfiguration`, `SecurityExtension::createUserProviders()` / `getUserProvider()`,
`AbstractFactory`, `CustomAuthenticatorFactory`, `HttpUtils`, `EntityFactory` de doctrine-bridge).

`SecurityConfig` lit les blocs `security:` (racine puis `when@dev`) de tous les YAML que `MicroKernelTrait` charge :
`config/packages/*`, `config/packages/dev/*` (triés), `config/services.yaml`, `config/services_dev.yaml` (n'importe lequel
peut contenir de la config d'extension). Un document ouvert remplace son fichier ; un YAML invalide garde les
déclarations précédentes.

Références reconnues (`security/securityYaml.ts`), seulement pour les scalaires dont le texte source est la valeur (simple
ou entre guillemets sans échappement, sur une ligne) ; une valeur vide compte pour la complétion :
- **providers** : `provider:` d'un firewall, `provider:` de chacun de ses blocs (authenticators d'`AbstractFactory`,
  `http_basic`, `x509`, `remote_user`, `login_link`, `switch_user`), éléments de `chain.providers` (séquence, ou chaîne
  découpée sur `,` comme `MainConfiguration`). Comparaison souple (`providerKey` : `-` lu comme `_`, casse ignorée) :
  sur-ensemble des noms que `SecurityExtension` résout (firewall : `str_replace('-', '_')` ; chaîne : `strtolower()`) ;
- **services** (sans `@`) : `id` d'un provider, `user_checker`, `access_denied_handler`, `custom_authenticators[]`,
  `success_handler` / `failure_handler` d'un bloc, `entry_point` sauf s'il nomme une clé du firewall (`form_login`) ;
  un id qui est un nom de classe à namespace est aussi une référence de classe ;
- **entité** : `entity.class` (classe via PSR-4) et `entity.property` (champs mappés `Column`, pas les associations :
  `EntityUserProvider` cherche par `findOneBy([property => identifiant])`) ;
- **routes** : noms seuls pour `access_control[].route` (attribut `_route` du `RequestMatcher`), `login_link.check_route`
  et `switch_user.target_route` (passés à `UrlGenerator::generate()`). Route ou chemin, lus par `HttpUtils` : `login_path`,
  `check_path`, `default_target_path`, `failure_path` d'un bloc d'authenticator, `logout.path`, `logout.target`,
  `access_denied_url` ; c'est un nom de route sauf si la valeur commence par `/` (`//hôte` compris) ou est une URL absolue
  (schéma + hôte, comme `parse_url()` dans `generateUri()`). Valeur contenant `%` : aucune réponse ;
- **rôles** : clés de `role_hierarchy` (déclarations) et leurs valeurs, `access_control[].roles`, `roles` des utilisateurs
  `memory`, `switch_user.role` (un seul attribut, non découpé). Séquence, ou chaîne découpée sur `,` comme la config.
  `access_control` et `switch_user` passent par `isGranted()` : les attributs d'`AuthenticatedVoter` (`PUBLIC_ACCESS`,
  `IS_AUTHENTICATED[_FULLY|_REMEMBERED]`, `IS_REMEMBERED`, `IS_IMPERSONATOR`) y sont aussi proposés.
Définition : route (comme en PHP/Twig), déclaration du provider, champ de l'entité, rôle (clé de `role_hierarchy`),
service (comme dans `services.yaml`) puis classe. Complétion : providers (une fois par nom, type en détail), champs, ids
de service, noms de route, rôles (tous ceux de la config, rôles atteignables en détail ; rien sur une clé de hiérarchie).
Survol : routes, services, rôles (rôles inclus et rôles qui l'incluent, déclaration ; description d'un attribut du voter ;
rien pour un rôle hors hiérarchie). Les noms de route ont le diagnostic `route-not-found` (`RouteIndex.isCertain()`).
Hiérarchie : la dernière déclaration d'un rôle remplace les précédentes (`performNoDeepMerging()`), rôles atteignables par
fermeture transitive comme `RoleHierarchy::buildRoleMap()`. Aucun diagnostic de rôle : un rôle peut venir de
`User::getRoles()`.

Rôles dans le code (`RoleReferenceFinder`, vérifié dans FrameworkBundle / SecurityBundle / TwigBridge 7.4) : littéral passé
comme attribut à `->isGranted()` (1ᵉʳ positionnel, `attribute:` d'AbstractController et `AuthorizationCheckerInterface`,
`attributes:` de `Security`), `->denyAccessUnlessGranted()` (1ᵉʳ, `attribute:`), `->isGrantedForUser()` (2ᵉ, `attribute:`),
quel que soit l'objet ; `#[IsGranted]` si son nom se résout (via les `use`) en `Symfony\Component\Security\Http\Attribute\IsGranted`
(1ᵉʳ, `attribute:`) ; Twig `is_granted()` (1ᵉʳ) et `is_granted_for_user()` (2ᵉ), positionnels seulement. Variable,
concaténation, interpolation, `Expression`, closure, dépaquetage : aucune réponse. Complétion (rôles de la config
`security` et attributs d'`AuthenticatedVoter`), définition (clé de `role_hierarchy`) et survol identiques au YAML ;
pas de diagnostic (un attribut peut être celui d'un voter personnalisé). Les rôles écrits en dur dans `src/` (par
exemple dans `getRoles()`) ne sont pas proposés.

Diagnostic « provider inconnu » (Warning, code `security-provider-not-found`, `SecurityExtension` lève une exception) seulement
si `SecurityConfig.isCertain()` : aucun `.php` dans `config/packages/` ni `config/packages/dev/`, pas de `services.php` à la
place de `services.yaml`, tous les YAML valides et sans `imports:`. Les ids de service suivent le diagnostic
`service-not-found` (mêmes conditions) ; `entry_point` n'en a pas (`RegisterEntryPointPass` accepte aussi des clés).
Limites connues : une valeur vide après une virgule dans une séquence en ligne (`[a, ]`) n'a pas de nœud, donc pas de
complétion avant la première lettre ; un bundle qui ajoute un provider par `prepend` n'est pas vu.

---

## Roadmap

Cocher au fur et à mesure. **Ne travailler que sur la phase en cours.**

### Phase 0 : squelette
- [x] `extension.toml`, `Cargo.toml`, `lib.rs` lançant `node server/dist/server.js`
- [x] Serveur LSP qui démarre, log son initialisation, détecte la racine Symfony
- [x] Installable via `zed: install dev extension` sous Windows

### Phase 1 : templates (priorité)
- [x] Definition : `render()`, `renderView()`, `renderBlock()`, `#[Template('...')]` en PHP
- [x] Definition Twig : `{% extends %}`, `{% include %}`, `{% embed %}`, `{% import %}`, `{% from %}`, `{% use %}`, `{{ include() }}`, `{{ source() }}`
      (y compris chaque littéral d'un tableau ou d'un ternaire)
- [x] Support des namespaces `@Bundle/` et `twig.paths`
- [x] Completion des noms de templates dans ces mêmes positions
- [x] Diagnostic : template introuvable (uniquement sur chaîne littérale)

### Phase 2 : routes
- [x] Definition + completion : `path()`, `url()` (Twig), `redirectToRoute()`, `generateUrl()` (PHP)
- [x] Hover : chemin, méthodes HTTP, contrôleur
- [x] Completion des paramètres de route
- [x] Diagnostic : route inconnue

### Phase 3 : services
- [x] Definition + completion des IDs dans `config/services.yaml` (`@service_id`)
- [x] `#[Autowire(service: '...')]`, `#[Autowire('%param%')]`
- [x] Hover : classe, tags, alias
- [x] Diagnostic : service inconnu (uniquement si le container compilé est présent et la config lisible)

### Phase 4 : traductions
- [x] Definition + completion : `trans()`, `|trans`, `{% trans %}`
- [x] Diagnostic : clé manquante dans la locale par défaut

### Phase 5 : Doctrine et Forms
- [x] `getRepository(Entity::class)` → repository
- [x] Completion des champs d'entité dans les form types et le QueryBuilder (alias simples)
- [ ] Définition dans le QueryBuilder : `alias.champ` → propriété, alias → entité — codé, à vérifier dans Zed
- [ ] `mappedBy` / `inversedBy` / `indexBy` des associations : définition et complétion — codé, à vérifier dans Zed
- [ ] Coloration du DQL (semantic tokens, `"semantic_tokens": "combined"` dans Zed) — alias vérifiés dans Zed, reste à vérifier

### Phase 6 : paramètres et variables d'environnement
- [x] Definition + completion des `%param%` dans le YAML (container compilé + `parameters:`)
- [x] Completion des `%env(...)%` (fichiers `.env*`, processeurs `int:`, `bool:`, `json:`…)

### Phase 7 : Messenger et Event Dispatcher
- [x] Message → handlers (`#[AsMessageHandler]`, tag `messenger.message_handler`)
- [x] Événement → listeners et subscribers (`#[AsEventListener]`, `getSubscribedEvents()`) — codé, à vérifier dans Zed

### Phase 8 : sécurité
- [x] `security.yaml` : providers (définition, complétion, diagnostic), entité du provider, services des firewalls — codé, à vérifier dans Zed
- [x] `security.yaml` : routes des firewalls (`login_path`, `check_path`…) et `access_control[].route` — codé, à vérifier dans Zed
- [x] `security.yaml` : rôles (`role_hierarchy`, `access_control[].roles`, `switch_user.role`)
- [x] Rôles dans le code : `is_granted()` (Twig), `#[IsGranted]`, `->isGranted()`, `->denyAccessUnlessGranted()`

### Phase 9 : publication
- [ ] Paquet npm du serveur et installation via `zed::npm_install_package` dans `lib.rs`
- [ ] Vérifier les règles du registre Zed (id d'extension sans `zed` ?) et choisir la licence
- [ ] Publication dans `zed-industries/extensions`

---

## Extension Zed (`lib.rs`)

- Déclarer le serveur pour les langages `PHP`, `Twig` et `YAML` dans `extension.toml`.
  Le langage Twig nécessite l'extension Twig communautaire de Zed : le documenter dans le README.
- Résolution du serveur, dans l'ordre :
  1. Mode dev : `lsp.symfony-zed.settings.server_path` (lu avec `LspSettings::for_worktree`),
     chemin absolu de `<repo>/server/dist/server.js`, lancé avec le Node de Zed.
     **Ne pas utiliser `lsp.symfony-zed.binary.path`** : quand il est défini, Zed court-circuite
     l'extension et exécute ce chemin lui-même comme exécutable (constaté : `os error 193` sous
     Windows avec un `.js`). `binary` reste l'override complet de Zed (ex. `node.exe` + arguments).
  2. Sinon, installer le paquet npm du serveur avec `zed::npm_install_package` et le lancer.
     **Pas encore implémenté** (aucun paquet publié) : sans `server_path`, `lib.rs` renvoie une
     erreur explicite demandant de le configurer.
- Toujours lancer Node via `zed::node_binary_path()`, ne jamais supposer `node` dans le PATH.
- Transmettre `--stdio` au serveur.

---

## Règles Windows / cross-platform

- Construire les chemins avec `path.join` / `path.resolve`. Interdit : concaténer avec `'/'`.
- Conversion URI ⇄ chemin uniquement via `URI.file()` / `URI.parse().fsPath`.
- Comparaison de chemins insensible à la casse sous Windows (`process.platform === 'win32'`).
- Les noms de templates Twig utilisent toujours `/`, même sous Windows : normaliser avant comparaison.
- Fins de ligne : gérer `\r\n` dans le calcul des positions (lignes/colonnes LSP en UTF-16).
- Les tests doivent passer sous Windows et Linux.

---

## Conventions de code

- TypeScript strict, pas de `any` (utiliser `unknown` + garde de type), pas de `// @ts-ignore`.
- Une classe par fichier, nommage PascalCase pour les classes, camelCase pour les fonctions.
- Chaque fonctionnalité expose des fonctions pures testables (entrée : document + index ; sortie : résultat LSP).
  `server.ts` ne fait que le câblage.
- Requêtes tree-sitter dans des fichiers `.scm` dédiés plutôt qu'en chaînes inline quand elles dépassent une ligne.
- Logs via `connection.console`, préfixés par le module (`[TemplateIndex] ...`). Pas de `console.log`.
- Gestion d'erreurs : aucune exception ne doit faire tomber le serveur ; attraper au niveau du handler LSP et logger.

---

## Tests

- Chaque fonctionnalité a ses tests dans `server/tests/features/<feature>/`.
- La fixture `tests/fixtures/symfony-app/` reproduit un vrai projet : `composer.json`, `bin/console`,
  `config/packages/twig.yaml` avec un namespace, `templates/`, un faux bundle dans `vendor/`
  avec override dans `templates/bundles/`, contrôleurs avec `#[Route]`, `var/cache/dev/` minimal.
- Tester les cas négatifs : chaîne dynamique, template absent, projet non Symfony.
- Une fonctionnalité n'est terminée que si ses tests passent **et** qu'elle a été vérifiée dans Zed.

---

## Commandes

```bash
# Serveur
cd server
npm install
npm run build      # esbuild → dist/server.js
npm run watch      # rebuild auto
npm test           # vitest
npm run lint       # tsc --noEmit

# Extension (compilée par Zed lors de l'installation en dev)
cargo check
```

### Tester dans Zed

1. `npm run build` dans `server/`
2. Zed → palette → `zed: install dev extension` → sélectionner la racine du repo
3. Dans les settings Zed :
   ```json
   "lsp": {
     "symfony-zed": {
       "settings": { "server_path": "C:\\chemin\\vers\\symfony-zed\\server\\dist\\server.js" }
     }
   },
   "languages": {
     "PHP": { "semantic_tokens": "combined" }
   }
   ```
   `semantic_tokens` est désactivé par défaut dans Zed : sans lui, le DQL n'est pas coloré. Zed fusionne les tokens de
   tous les serveurs d'un fichier (Intelephense + symfony-zed) ; changer ce réglage demande de redémarrer le serveur.
4. Ouvrir un projet Symfony, puis `dev: open language server logs` pour voir les logs du serveur
5. Après une modification du serveur : rebuild, puis redémarrer le serveur LSP depuis la palette

---

## Façon de travailler (pour Claude Code)

- Proposer un plan avant toute modification touchant plus de 2 fichiers.
- Avancer par petites étapes vérifiables ; une case de roadmap = un commit.
- Ne pas anticiper les phases suivantes (pas d'abstraction « pour plus tard »).
- Mettre à jour les cases de la roadmap et ce fichier quand une décision d'architecture change.
- Messages de commit au format Conventional Commits (`feat(templates): ...`, `fix(paths): ...`).
- En cas de doute sur le comportement de Symfony ou de l'API Zed, le signaler au lieu de deviner.
