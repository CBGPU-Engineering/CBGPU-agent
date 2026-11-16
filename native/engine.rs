use crate::{Failure, Result};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
pub fn config(base: &str, root: &Path, web_binary: &Path) -> Value {
    let mut v: Value = serde_json::from_str(include_str!("opencode-config.json"))
        .expect("embedded OpenCode config");
    v["provider"]["cbgpu"]["options"]["baseURL"] = json!(base);
    v["mcp"]["cbgpu-web"]["environment"]["CBGPU_BASE_URL"] = json!(base);
    v["mcp"]["cbgpu-web"]["command"] = json!([web_binary, "web-mcp"]);
    let root = root.to_string_lossy();
    v["agent"]["cbgpu"]["prompt"] = json!(
        v["agent"]["cbgpu"]["prompt"]
            .as_str()
            .unwrap()
            .replace("CBGPU_PROJECT_ROOT_PLACEHOLDER", &root)
    );
    if root != "/" && !root.contains(['?', '*']) {
        let mut rule = serde_json::Map::new();
        rule.insert("*".into(), json!("ask"));
        rule.insert(format!("{}/*", root.replace('\\', "/")), json!("allow"));
        v["permission"]["external_directory"] = Value::Object(rule);
    }
    v
}
pub fn arguments(args: &[String]) -> Vec<String> {
    let mut args = args.to_vec();
    if args.is_empty() || (args[0] == "run" && !args.iter().any(|a| a == "--agent")) {
        args.extend(["--agent".into(), "cbgpu".into()]);
    }
    if !args.iter().any(|a| a == "--pure") {
        args.push("--pure".into());
    }
    args
}
pub async fn launch(args: &[String], base: &str, key: &str) -> Result<i32> {
    let path=std::env::var_os("CBGPU_AGENT_OPENCODE_PATH").map(PathBuf::from).ok_or_else(||Failure::new("OpenCode dependency was not resolved. Use the packaged launcher, or set an absolute CBGPU_AGENT_OPENCODE_PATH to the installed upstream executable."))?;
    if !path.is_absolute() || !path.is_file() {
        return Err(Failure::new(
            "OpenCode executable must be an installed absolute file path.",
        ));
    }
    let root =
        std::env::current_dir().map_err(|_| Failure::new("Project directory unavailable."))?;
    let own = std::env::current_exe().map_err(|_| Failure::new("Agent executable unavailable."))?;
    let mut child = tokio::process::Command::new(path)
        .args(arguments(args))
        .env("CBGPU_API_KEY", key)
        .env(
            "OPENCODE_CONFIG_CONTENT",
            config(base, &root, &own).to_string(),
        )
        .env("OPENCODE_DISABLE_AUTOUPDATE", "1")
        .env("OPENCODE_DISABLE_DEFAULT_PLUGINS", "1")
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| {
            Failure::new("Could not start the installed OpenCode engine. Reinstall CBGPU Agent.")
        })?;
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut term = signal(SignalKind::terminate())
            .map_err(|_| Failure::new("Signal handler unavailable."))?;
        let mut int = signal(SignalKind::interrupt())
            .map_err(|_| Failure::new("Signal handler unavailable."))?;
        loop {
            tokio::select! {status=child.wait()=>return status.map(|s|s.code().unwrap_or(1)).map_err(|_|Failure::new("OpenCode exited unexpectedly.")),_=term.recv()=>{if let Some(pid)=child.id(){unsafe{libc::kill(pid as i32,libc::SIGTERM);}}},_=int.recv()=>{if let Some(pid)=child.id(){unsafe{libc::kill(pid as i32,libc::SIGINT);}}}}
        }
    }
    #[cfg(not(unix))]
    {
        let status = child
            .wait()
            .await
            .map_err(|_| Failure::new("OpenCode exited unexpectedly."))?;
        Ok(status.code().unwrap_or(1))
    }
}
