use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

const SERVER_NAME: &str = "symfony-zed";

/// Key of `lsp.symfony-zed.settings` holding the path of `server/dist/server.js`.
///
/// `lsp.symfony-zed.binary.path` cannot be used for this: when it is set, Zed bypasses the
/// extension and spawns that path itself as the executable (a `.js` file is not one).
const SERVER_PATH_SETTING: &str = "server_path";

struct SymfonyExtension;

impl zed::Extension for SymfonyExtension {
    fn new() -> Self {
        SymfonyExtension
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let server_path = LspSettings::for_worktree(SERVER_NAME, worktree)
            .ok()
            .and_then(|settings| settings.settings)
            .and_then(|settings| {
                settings
                    .get(SERVER_PATH_SETTING)
                    .and_then(|value| value.as_str())
                    .map(str::to_owned)
            })
            .filter(|path| !path.trim().is_empty())
            .ok_or_else(|| {
                format!(
                    "{SERVER_NAME}: no server configured. Set \"lsp.{SERVER_NAME}.settings.{SERVER_PATH_SETTING}\" \
                     to the absolute path of server/dist/server.js in your Zed settings."
                )
            })?;

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![server_path, "--stdio".to_string()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(SymfonyExtension);
