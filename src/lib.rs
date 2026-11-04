use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

const SERVER_NAME: &str = "symfony-zed";

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
        let binary = LspSettings::for_worktree(SERVER_NAME, worktree)
            .ok()
            .and_then(|settings| settings.binary);

        let server_path = binary
            .as_ref()
            .and_then(|binary| binary.path.clone())
            .ok_or_else(|| {
                format!(
                    "{SERVER_NAME}: no server configured. Set \"lsp.{SERVER_NAME}.binary.path\" \
                     to the absolute path of server/dist/server.js in your Zed settings."
                )
            })?;

        let mut args = vec![server_path];
        if let Some(extra) = binary.as_ref().and_then(|binary| binary.arguments.clone()) {
            args.extend(extra);
        }
        if !args.iter().any(|arg| arg == "--stdio") {
            args.push("--stdio".to_string());
        }

        let env = binary
            .and_then(|binary| binary.env)
            .map(|env| env.into_iter().collect())
            .unwrap_or_default();

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args,
            env,
        })
    }
}

zed::register_extension!(SymfonyExtension);
