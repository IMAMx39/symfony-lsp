# symfony-lsp

A language server for [Symfony](https://symfony.com) projects: navigation, completion, hover and diagnostics
for templates, routes, services, parameters, translations, Doctrine, Messenger, events and security, in PHP,
Twig and YAML files.

It is the server of the **Symfony** extension for the [Zed](https://zed.dev) editor, which installs and
updates this package automatically. It speaks the standard Language Server Protocol, so other editors can
use it too.

- **No PHP on the host.** The kernel is never booted: the server reads the project files and the compiled
  cache in `var/cache/dev`. Projects running in Docker work out of the box.
- **Windows, macOS and Linux.**
- **No runtime dependency.** The package is a single bundled script plus the tree-sitter grammars (WASM).
- **Conservative.** When the answer is uncertain (dynamic strings, PHP configuration files, missing cache),
  it stays silent rather than guessing.

## Features

| Area | Where | What you get |
|---|---|---|
| Templates | `render()`, `renderView()`, `renderBlock()`, `#[Template]`; Twig `extends`, `include`, `embed`, `import`, `from`, `use`, `include()`, `source()` | Go to definition, completion, missing template warning. `@Bundle/`, `@!Bundle/`, `twig.paths`, bundle overrides |
| Routes | `path()`, `url()`, `redirectToRoute()`, `generateUrl()`, `security.yaml` | Go to definition, completion of names and parameters, hover (path, methods, controller), unknown route warning |
| Services | `'@id'` in `config/services.yaml`, `#[Autowire]`, `security.yaml` | Go to definition, completion, hover (class, tags, aliases), unknown service warning |
| Parameters | `%param%` and `%env(...)%` in YAML and `#[Autowire]` | Go to definition, completion of parameters, `.env` variables and env processors |
| Translations | `->trans()`, `\|trans`, `{% trans %}` | Go to definition, completion, missing key warning for the default locale |
| Doctrine | `getRepository()`, form types, QueryBuilder, `findBy()` / `findOneBy()` / `count()`, `mappedBy` / `inversedBy` / `indexBy` | Go to repository or property, completion of entity fields, DQL semantic highlighting |
| Messenger, events | Message and event classes, event names and constants | Go to implementation lists handlers, listeners and subscribers |
| Security | `security.yaml`, `is_granted()`, `#[IsGranted]`, `->isGranted()`, `->denyAccessUnlessGranted()` | Providers, firewall services and routes, roles and role hierarchy |

## Usage

The server communicates over stdio and needs Node.js 20 or later:

```bash
npm install symfony-lsp
node node_modules/symfony-lsp/dist/server.js --stdio
```

Register it for the PHP, Twig and YAML languages in your editor. It detects the Symfony project from the
workspace folder (a folder with `composer.json` and `bin/console`, or one of its direct subfolders).

Generate the dev cache in your container (`bin/console cache:warmup`) to get bundle routes and services, and
the "not found" diagnostics.

### Zed

Install the **Symfony** extension from the Zed extensions page: nothing else to set up. Enable semantic
tokens for the DQL highlighting:

```json
{
  "languages": {
    "PHP": { "semantic_tokens": "combined" }
  }
}
```

## Links

- Source code, issues and Zed setup: <https://github.com/IMAMx39/symfony-lsp>
- Inspired by the [Symfony Plugin for PhpStorm](https://github.com/Haehnchen/idea-php-symfony2-plugin)

## License

MIT
