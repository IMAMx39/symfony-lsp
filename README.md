# Symfony for Zed

[Symfony](https://symfony.com) support for the [Zed](https://zed.dev) editor, in PHP, Twig and YAML files:
navigation, completion, hover and diagnostics for templates, routes, services, translations, Doctrine,
Messenger, events and security.

It reads your project files and the compiled cache in `var/cache/dev` only. **PHP is not needed on the host**
and the kernel is never booted, so projects running in Docker work out of the box. Windows, macOS and Linux
are supported.

## Installation

1. In Zed, open the extensions page (`zed: extensions`), search for **Symfony** and install it.
   The language server (the [`symfony-lsp`](https://www.npmjs.com/package/symfony-lsp) npm package) is
   downloaded and kept up to date automatically, and runs on the Node.js shipped with Zed.
2. For Twig files, also install the **Twig** extension (Zed has no built-in Twig language). The **PHP**
   extension provides the PHP language.
3. Open a Symfony project. It is detected when a folder contains `composer.json` and `bin/console`
   (or `config/bundles.php`): the opened folder first, then its direct subfolders (`app/` next to `docker/`).

Generate the dev cache in your container (`bin/console cache:warmup`, or any page load in `dev`) to get
bundle routes and services, and the "not found" diagnostics.

## Features

| Area | In | What you get |
|---|---|---|
| Templates | `render()`, `renderView()`, `renderBlock()`, `#[Template]`; Twig `extends`, `include`, `embed`, `import`, `from`, `use`, `include()`, `source()` | Go to definition, completion, missing template warning. `@Bundle/`, `@!Bundle/`, `twig.paths` and bundle overrides |
| Routes | `path()`, `url()`, `redirectToRoute()`, `generateUrl()`, `security.yaml` | Go to definition, completion of names and parameters, hover (path, methods, controller), unknown route warning |
| Services | `'@id'` in `config/services.yaml`, `#[Autowire]`, `security.yaml` | Go to definition, completion, hover (class, tags, aliases), unknown service warning |
| Parameters | `%param%` and `%env(...)%` in YAML and `#[Autowire]` | Go to definition, completion of parameters, `.env` variables and env processors |
| Translations | `->trans()`, `\|trans`, `{% trans %}` | Go to definition, completion, missing key warning (default locale) |
| Doctrine | `getRepository()`, form types, QueryBuilder, `findBy()` / `findOneBy()` / `count()`, `mappedBy` / `inversedBy` / `indexBy` | Go to repository or property, completion of entity fields, DQL highlighting |
| Messenger, events | Message and event classes, event names | Go to implementation lists the handlers and listeners |
| Security | `security.yaml`, `is_granted()`, `#[IsGranted]`, `->isGranted()`, `->denyAccessUnlessGranted()` | Providers, firewall services and routes, roles and role hierarchy |

When the answer is uncertain (dynamic strings, PHP configuration files, missing cache), the extension stays
silent rather than guessing.

## Settings

### DQL highlighting

Zed only asks language servers for semantic highlighting when it is enabled:

```json
{
  "languages": {
    "PHP": { "semantic_tokens": "combined" }
  }
}
```

Restart the language server afterwards (`editor: restart language server`).

### Other PHP language servers

This server complements Intelephense or Phpactor, it does not replace them: it only answers at Symfony
positions. Zed merges the go-to-definition results of every server, so another server that also answers
inside strings makes Zed show a list instead of jumping. This is the case of `php-lsp`; with Intelephense,
disable it:

```json
{
  "languages": {
    "PHP": { "language_servers": ["symfony-lsp", "intelephense", "!php-lsp", "..."] }
  }
}
```

Messenger handlers and event listeners are listed with **go to implementation**
(`editor: go to implementation`) on a message or event class, an event constant or an event name.

## Development

Requirements: Rust through [rustup](https://rustup.rs) and Node.js 20+.

```bash
cd server
npm install
npm run build    # dist/server.js
npm test         # vitest
npm run lint     # tsc --noEmit
```

In Zed, run `zed: install dev extension` and select this repository, then point the extension at your local
build (it then skips the npm package):

```json
{
  "lsp": {
    "symfony-lsp": {
      "settings": { "server_path": "/absolute/path/to/server/dist/server.js" }
    }
  }
}
```

After a server change: `npm run build`, then `editor: restart language server`. Logs are in
`dev: open language server logs` → `symfony-lsp`.

## Credits

Inspired by the [Symfony Plugin for PhpStorm](https://github.com/Haehnchen/idea-php-symfony2-plugin).

## License

[MIT](LICENSE)
