# symfony-lsp

Language server for [Symfony](https://symfony.com) projects, used by the **Symfony** extension of the
[Zed](https://zed.dev) editor, which installs and updates it automatically.

It provides navigation, completion, hover and diagnostics for templates, routes, services, parameters,
translations, Doctrine, Messenger, events and security, in PHP, Twig and YAML files. It reads the project
files and the compiled cache in `var/cache/dev` only: PHP is not needed on the host.

The bundle has no runtime dependency. Run it with `node dist/server.js --stdio`.

Documentation and sources: <https://github.com/IMAMx39/symfony-lsp>

License: MIT
