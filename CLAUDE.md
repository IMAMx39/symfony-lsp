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
│   │   │   ├── TwigConfig.ts       # Lecture twig.yaml (default_path, paths, when@dev)
│   │   │   ├── TwigLoaderPaths.ts  # Dossiers par namespace, dans l'ordre de TwigBundle
│   │   │   ├── TemplateResolver.ts # Nom de template → fichier
│   │   │   └── ProjectTemplates.ts # Regroupe chemins, résolveur et index d'un projet
│   │   ├── routing/                # Extraction des routes : #[Route], YAML, cache compilé
│   │   ├── index/
│   │   │   ├── TemplateIndex.ts
│   │   │   └── RouteIndex.ts
│   │   ├── parsing/
│   │   │   ├── parsers.ts          # Init web-tree-sitter (PHP, Twig)
│   │   │   ├── DocumentTrees.ts    # Arbres des documents ouverts (cache par version)
│   │   │   ├── literals.ts / phpValues.ts / phpNames.ts  # Littéraux, valeurs, noms de classes
│   │   │   └── queries/            # Requêtes tree-sitter (.scm)
│   │   ├── features/               # Un dossier par fonctionnalité
│   │   │   ├── templates/          # definition, completion, diagnostics
│   │   │   └── routes/             # definition, completion, hover, paramètres, diagnostics
│   │   └── util/
│   │       └── paths.ts            # Normalisation chemins/URI cross-platform
│   └── tests/
│       ├── fixtures/symfony-app/   # Mini projet Symfony réaliste
│       ├── features/               # Tests par fonctionnalité
│       ├── index/ project/ routing/ util/
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
| Services | `var/cache/dev/App_KernelDevDebugContainer.xml` (nom à détecter par glob `*Container.xml`) |
| Routes | Attributs `#[Route]` dans `src/Controller/**`, fichiers `config/routes/*.yaml`, et `var/cache/dev/url_generating_routes.php` si présent |
| Traductions | `translations/*.{yaml,xlf}` (domaine et locale déduits du nom de fichier) |
| Entités Doctrine | Attributs `#[ORM\Entity]` dans `src/Entity/**` |

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

---

## Roadmap

Cocher au fur et à mesure. **Ne travailler que sur la phase en cours.**

### Phase 0 : squelette
- [x] `extension.toml`, `Cargo.toml`, `lib.rs` lançant `node server/dist/server.js`
- [x] Serveur LSP qui démarre, log son initialisation, détecte la racine Symfony
- [ ] Installable via `zed: install dev extension` sous Windows

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
- [ ] Definition + completion des IDs dans `config/services.yaml` (`@service_id`)
- [ ] `#[Autowire(service: '...')]`, `#[Autowire('%param%')]`
- [ ] Hover : classe, tags, alias

### Phase 4 : traductions
- [ ] Definition + completion : `trans()`, `|trans`, `{% trans %}`
- [ ] Diagnostic : clé manquante dans la locale par défaut

### Phase 5 : Doctrine et Forms
- [ ] `getRepository(Entity::class)` → repository
- [ ] Completion des champs d'entité dans les form types et le QueryBuilder (alias simples)

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
   }
   ```
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
