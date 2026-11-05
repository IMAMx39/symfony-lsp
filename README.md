# symfony-zed

Extension [Zed](https://zed.dev) apportant le support de Symfony (templates, routes, services,
traductions) dans PHP, Twig et YAML, **sans PHP sur l'hôte** et sans démarrer le kernel.
Pensée d'abord pour Windows, fonctionne aussi sous macOS et Linux.

> Statut : phase 1 (templates). Navigation, complétion et diagnostic des noms de templates
> en PHP (`render()`, `renderView()`, `renderBlock()`, `#[Template]`) et en Twig (`extends`,
> `include`, `embed`, `import`, `from`, `use`, `include()`, `source()`), avec les namespaces
> `@Bundle/`, `@!Bundle/` et `twig.paths`.

## Prérequis

- Zed (Windows, macOS ou Linux)
- Rust via [rustup](https://rustup.rs) (Zed compile l'extension en WASM lors de l'installation en dev)
- Node.js 20+ pour construire le serveur (à l'exécution, Zed fournit son propre Node)
- Pour Twig : l'extension communautaire **Twig** de Zed (le langage `Twig` n'est pas intégré à Zed)
- Pour PHP : l'extension **PHP** de Zed

## Installation en développement

1. Construire le serveur :
   ```bash
   cd server
   npm install
   npm run build
   ```
2. Dans Zed : palette → `zed: install dev extension` → sélectionner la racine de ce dépôt.
3. Dans les settings Zed (`settings.json`), indiquer le chemin du serveur :
   ```json
   {
     "lsp": {
       "symfony-zed": {
         "binary": {
           "path": "C:\\chemin\\vers\\symfony-zed\\server\\dist\\server.js"
         }
       }
     }
   }
   ```
   Sans ce réglage, le serveur ne démarre pas (pas encore de paquet npm publié).
4. Ouvrir un projet Symfony, puis palette → `dev: open language server logs` et choisir
   `symfony-zed`. On doit voir :
   ```
   [Server] symfony-zed 0.0.1 initialized (...)
   [SymfonyProject] Symfony project detected at ...
   ```

Après une modification du serveur : `npm run build`, puis palette → `editor: restart language server`.

## Détection du projet

Un dossier est une racine Symfony s'il contient `composer.json` et `bin/console`
(ou `config/bundles.php`). Le dossier ouvert dans Zed est testé en premier, puis ses
sous-dossiers directs (cas `docker/` + `app/`). Si plusieurs sous-dossiers sont des projets
Symfony, aucun n'est retenu.

## Développement

```bash
cd server
npm run lint     # tsc --noEmit
npm test         # vitest
npm run watch    # rebuild automatique
cargo check      # depuis la racine, vérifie l'extension Rust
```
