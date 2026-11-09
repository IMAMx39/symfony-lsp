# symfony-zed

Extension [Zed](https://zed.dev) apportant le support de Symfony (templates, routes, services,
traductions) dans PHP, Twig et YAML, **sans PHP sur l'hôte** et sans démarrer le kernel.
Pensée d'abord pour Windows, fonctionne aussi sous macOS et Linux.

> Statut : phases 1 à 3 terminées.
>
> - **Templates** : navigation, complétion et diagnostic des noms de templates en PHP
>   (`render()`, `renderView()`, `renderBlock()`, `#[Template]`) et en Twig (`extends`, `include`,
>   `embed`, `import`, `from`, `use`, `include()`, `source()`), namespaces `@Bundle/`, `@!Bundle/`, `twig.paths`.
> - **Routes** : navigation, complétion, survol et diagnostic des noms de routes dans `path()`, `url()`,
>   `redirectToRoute()`, `generateUrl()`, et complétion de leurs paramètres. Les routes de bundles et le
>   diagnostic nécessitent le cache `var/cache/dev/` (généré par Symfony dans le conteneur).
> - **Services** : navigation, complétion, survol (classe, tags, alias) et diagnostic des
>   `'@service_id'` dans `config/services.yaml` et de `#[Autowire(service: ...)]` / `#[Autowire('@...')]`,
>   navigation et complétion des paramètres dans `#[Autowire('%param%')]` / `#[Autowire(param: ...)]`.
>   Source : le container compilé `var/cache/dev/*Container.xml` et les déclarations du YAML ; le
>   diagnostic exige un container plus récent que la configuration.

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
         "settings": {
           "server_path": "C:\\chemin\\vers\\symfony-zed\\server\\dist\\server.js"
         }
       }
     }
   }
   ```
   Sans ce réglage, le serveur ne démarre pas (pas encore de paquet npm publié). Ne pas utiliser
   `binary.path` pour ce fichier : Zed lancerait alors le `.js` lui-même comme un exécutable.
4. Ouvrir un projet Symfony, puis palette → `dev: open language server logs` et choisir
   `symfony-zed`. On doit voir :
   ```
   [Server] symfony-zed 0.0.1 initialized (...)
   [SymfonyProject] Symfony project detected at ...
   ```

Après une modification du serveur : `npm run build`, puis palette → `editor: restart language server`.

## Cohabitation avec les autres serveurs

`symfony-zed` complète les serveurs de langage existants (Intelephense ou Phpactor pour PHP,
yaml-language-server pour YAML), il ne les remplace pas. Il ne répond qu'aux positions Symfony
(nom de template, de route ou de service dans une chaîne littérale) et renvoie un résultat vide
partout ailleurs. Il n'expose ni formatage, ni renommage, ni code actions.

Zed interroge **tous** les serveurs d'un fichier pour « aller à la définition » et fusionne leurs
réponses : l'ordre de `language_servers` n'a pas d'importance. Si un autre serveur répond aussi,
Zed affiche la liste des résultats au lieu de sauter directement au template.

C'est le cas de **php-lsp** : il renvoie la définition de la fonction appelée (`render()`) même
quand le curseur est dans la chaîne. Intelephense, lui, ne répond rien sur une chaîne. Avec
Intelephense pour la navigation PHP, désactiver php-lsp (`!`) :

```json
{
  "languages": {
    "PHP": { "language_servers": ["symfony-zed", "intelephense", "!php-lsp", "..."] }
  }
}
```

`"..."` désigne les autres serveurs activés par défaut.

Les handlers Messenger d'un message s'ouvrent avec **« aller à l'implémentation »**
(`editor: go to implementation`) sur le nom de sa classe : déclaration, `new Message()`,
`Message::class` ou type d'un paramètre. `symfony-zed` ne répond que si la classe a des handlers.
Sur une interface ou une classe parente, Intelephense peut aussi répondre (ses implémentations).

Après `zed: install dev extension`, Zed arrête `symfony-zed` sans toujours le relancer : faire
`editor: restart language server` (fichier PHP ouvert), ou redémarrer Zed si cela ne suffit pas.

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

## Roadmap

| Phase | Contenu | Statut |
|---|---|---|
| 0 | Squelette : extension Zed, serveur LSP, détection du projet | Fait (installation sous Windows à valider) |
| 1 | Templates : navigation, complétion, diagnostic | Fait |
| 2 | Routes : navigation, complétion, survol, paramètres, diagnostic | Fait |
| 3 | Services : IDs dans le YAML, `#[Autowire]`, survol, diagnostic | Fait |
| 4 | Traductions : `trans()`, `\|trans`, `{% trans %}`, clés manquantes | En cours |
| 5 | Doctrine et Forms : repositories, champs d'entité | Prévu |
| 6 | Paramètres `%param%` et variables d'environnement `%env()%` | Prévu |
| 7 | Messenger et Event Dispatcher : handlers, listeners, subscribers | En cours |
| 8 | Sécurité : `security.yaml` | Prévu |
| 9 | Publication : paquet npm, registre des extensions Zed | Prévu |

Le détail de chaque phase est dans [CLAUDE.md](CLAUDE.md).

## Références

- [Zed : extensions](https://zed.dev/docs/extensions)
- [Zed : langages](https://zed.dev/docs/languages)
- [Registre des extensions Zed](https://github.com/zed-industries/extensions)
- [Spécification du Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
- [Documentation Symfony](https://symfony.com/doc/current/index.html)
- [Documentation Composer](https://getcomposer.org/doc/)
- [Symfony Plugin pour PhpStorm](https://github.com/Haehnchen/idea-php-symfony2-plugin) (inspiration)

## Licence

À choisir avant la première publication.
