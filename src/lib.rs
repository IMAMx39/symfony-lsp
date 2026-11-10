use std::{env, fs};

use zed_extension_api::{
    self as zed, settings::LspSettings, LanguageServerId, LanguageServerInstallationStatus, Result,
};

/// Language server id (`lsp.symfony-lsp` in the Zed settings) and npm package of the server.
const SERVER_NAME: &str = "symfony-lsp";
const PACKAGE_NAME: &str = "symfony-lsp";
/// Entry point of the server inside the installed npm package.
const PACKAGE_SCRIPT: &str = "node_modules/symfony-lsp/dist/server.js";

/// Key of `lsp.symfony-lsp.settings` holding the path of a local `server/dist/server.js`
/// (development). When set, the npm package is not used.
///
/// `lsp.symfony-lsp.binary.path` cannot be used for this: when it is set, Zed bypasses the
/// extension and spawns that path itself as the executable (a `.js` file is not one).
const SERVER_PATH_SETTING: &str = "server_path";

struct SymfonyExtension {
    /// The npm package was checked during this session: no need to query the registry again.
    checked_package: bool,
}

impl SymfonyExtension {
    /// `server_path` from the settings of the worktree, if set.
    fn configured_server_path(worktree: &zed::Worktree) -> Option<String> {
        LspSettings::for_worktree(SERVER_NAME, worktree)
            .ok()
            .and_then(|settings| settings.settings)
            .and_then(|settings| {
                settings
                    .get(SERVER_PATH_SETTING)
                    .and_then(|value| value.as_str())
                    .map(str::to_owned)
            })
            .filter(|path| !path.trim().is_empty())
    }

    /// Absolute path of the server script of the npm package, installed or updated first.
    /// An installed version is kept when the registry cannot be reached.
    fn package_server_path(&mut self, language_server_id: &LanguageServerId) -> Result<String> {
        let script = env::current_dir()
            .map_err(|error| format!("{SERVER_NAME}: cannot read the extension directory: {error}"))?
            .join(PACKAGE_SCRIPT)
            .to_string_lossy()
            .into_owned();
        let installed = zed::npm_package_installed_version(PACKAGE_NAME)?;
        if self.checked_package && installed.is_some() && fs::metadata(&script).is_ok() {
            return Ok(script);
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &LanguageServerInstallationStatus::CheckingForUpdate,
        );
        match zed::npm_package_latest_version(PACKAGE_NAME) {
            Ok(latest) if installed.as_deref() != Some(latest.as_str()) => {
                zed::set_language_server_installation_status(
                    language_server_id,
                    &LanguageServerInstallationStatus::Downloading,
                );
                if let Err(error) = zed::npm_install_package(PACKAGE_NAME, &latest) {
                    if installed.is_none() || fs::metadata(&script).is_err() {
                        return Err(format!("{SERVER_NAME}: cannot install the npm package {PACKAGE_NAME}: {error}"));
                    }
                }
            }
            Ok(_) => {}
            Err(error) => {
                if installed.is_none() {
                    return Err(format!("{SERVER_NAME}: cannot find the npm package {PACKAGE_NAME}: {error}"));
                }
            }
        }
        zed::set_language_server_installation_status(
            language_server_id,
            &LanguageServerInstallationStatus::None,
        );

        if fs::metadata(&script).is_err() {
            return Err(format!("{SERVER_NAME}: {script} is missing from the installed npm package"));
        }
        self.checked_package = true;
        Ok(script)
    }
}

impl zed::Extension for SymfonyExtension {
    fn new() -> Self {
        SymfonyExtension {
            checked_package: false,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let server_path = match Self::configured_server_path(worktree) {
            Some(path) => path,
            None => self.package_server_path(language_server_id)?,
        };
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![server_path, "--stdio".to_string()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(SymfonyExtension);
