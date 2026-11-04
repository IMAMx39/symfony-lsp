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
│   ├── src/
│   │   ├── server.ts               # Bootstrap LSP, enregistrement des capabilities
│   │   ├── project/
│   │   │   ├── SymfonyProject.ts   # Détection projet, racine, chemins clés
│   │   │   └── TwigConfig.ts       # Lecture config/packages/twig.yaml (paths, namespaces)
│   │   ├── index/
│   │   │   ├── TemplateIndex.ts
│   │   │   ├── RouteIndex.ts
│   │   │   ├── ServiceIndex.ts
│   │   │   └── TranslationIndex.ts
│   │   ├── parsing/
│   │   │   ├── parsers.ts          # Init web-tree-sitter (PHP, Twig)
│   │   │   └── queries/            # Requêtes tree-sitter (.scm)
│   │   ├── features/               # Un dossier par fonctionnalité
│   │   │   ├── templates/          # definition, completion, hover, diagnostics
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   └── translations/
│   │   └── util/
│   │       └── paths.ts            # Normalisation chemins/URI cross-platform
│   └── tests/
│       ├── fixtures/symfony-app/   # Mini projet Symfony réaliste
│       └── features/               # Tests par fonctionnalité
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
  - `yaml` : lecture des fichiers de config et traductions YAML
  - `fast-xml-parser` : lecture du container compilé
  - `esbuild` : bundle en un seul `dist/server.js`
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
| Templates | `templates/`, chemins de `twig.paths` dans `config/packages/twig.yaml`, templates des bundles (`vendor/*/*/templates/`, `vendor/*/*/src/Resources/views/`) |
| Overrides de bundles | `templates/bundles/<NomBundle>/...` (prioritaires sur le bundle) |
| Services | `var/cache/dev/App_KernelDevDebugContainer.xml` (nom à détecter par glob `*Container.xml`) |
| Routes | Attributs `#[Route]` dans `src/Controller/**`, fichiers `config/routes/*.yaml`, et `var/cache/dev/url_generating_routes.php` si présent |
| Traductions | `translations/*.{yaml,xlf}` (domaine et locale déduits du nom de fichier) |
| Entités Doctrine | Attributs `#[ORM\Entity]` dans `src/Entity/**` |

### Résolution des noms de templates

- `'home/index.html.twig'` → chaque dossier racine Twig sans namespace, dans l'ordre (`templates/` en premier).
- `'@Foo/bar.html.twig'` → `templates/bundles/FooBundle/bar.html.twig` s'il existe, sinon dossier
  templates du bundle `FooBundle`, sinon chemin déclaré dans `twig.paths` avec le namespace `Foo`.
- `'@!Foo/...'` → idem sans tenir compte de l'override.
- Si plusieurs fichiers correspondent, renvoyer le premier selon l'ordre de priorité Twig.

---

## Roadmap

Cocher au fur et à mesure. **Ne travailler que sur la phase en cours.**

### Phase 0 : squelette
- [x] `extension.toml`, `Cargo.toml`, `lib.rs` lançant `node server/dist/server.js`
- [x] Serveur LSP qui démarre, log son initialisation, détecte la racine Symfony
- [ ] Installable via `zed: install dev extension` sous Windows

### Phase 1 : templates (priorité)
- [ ] Definition : `render()`, `renderView()`, `renderBlock()`, `#[Template('...')]` en PHP
- [ ] Definition Twig : `{% extends %}`, `{% include %}`, `{% embed %}`, `{% import %}`, `{% from %}`, `{{ include() }}`, `{{ source() }}`
- [ ] Support des namespaces `@Bundle/` et `twig.paths`
- [ ] Completion des noms de templates dans ces mêmes positions
- [ ] Diagnostic : template introuvable (uniquement sur chaîne littérale)

### Phase 2 : routes
- [ ] Definition + completion : `path()`, `url()` (Twig), `redirectToRoute()`, `generateUrl()` (PHP)
- [ ] Hover : chemin, méthodes HTTP, contrôleur
- [ ] Completion des paramètres de route
- [ ] Diagnostic : route inconnue

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
- Résolution du binaire, dans l'ordre :
  1. Override utilisateur via `lsp.symfony-zed.binary.path` / `arguments` (lu avec `LspSettings::for_worktree`).
     C'est le mode dev : pointer vers `<repo>/server/dist/server.js`.
  2. Sinon, installer le paquet npm du serveur avec `zed::npm_install_package` et le lancer.
     **Pas encore implémenté** (aucun paquet publié) : sans override, `lib.rs` renvoie une erreur
     explicite demandant de configurer `binary.path`.
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
       "binary": { "path": "C:\\chemin\\vers\\symfony-zed\\server\\dist\\server.js" }
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
