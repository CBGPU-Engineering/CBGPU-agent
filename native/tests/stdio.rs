use std::{
    io::Write,
    process::{Command, Stdio},
};
#[test]
fn readonly_web_mcp_discovers_without_a_key_and_never_exposes_local_tools() {
    let home = tempfile::tempdir().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_cbgpu"))
        .arg("web-mcp")
        .env_remove("CBGPU_API_KEY")
        .env("HOME", home.path())
        .env("USERPROFILE", home.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n")
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let msg: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let tools = msg["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 2);
    assert_eq!(tools[0]["name"], "web_search");
    assert_eq!(tools[1]["name"], "read_web_page");
    assert!(!String::from_utf8_lossy(&out.stdout).contains("cbgpu_ai_"));
}
#[test]
fn piped_login_rejected_before_any_secret_prompt_or_network() {
    let out = Command::new(env!("CARGO_BIN_EXE_cbgpu"))
        .arg("login")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("interactive terminal"));
}
#[cfg(unix)]
#[test]
fn default_rust_wrapper_executes_upstream_with_sessions_and_preserves_failure_status() {
    use std::os::unix::fs::PermissionsExt;
    let home = tempfile::tempdir().unwrap();
    let engine = home.path().join("upstream");
    std::fs::write(&engine,"#!/bin/sh\n[ \"$1\" = '--continue' ] || exit 91\n[ \"$2\" = '--session' ] || exit 92\n[ \"$3\" = 'existing-session' ] || exit 93\n[ \"$4\" = '--pure' ] || exit 94\n[ \"$OPENCODE_DISABLE_AUTOUPDATE\" = '1' ] || exit 95\n[ \"$OPENCODE_DISABLE_DEFAULT_PLUGINS\" = '1' ] || exit 96\nprintf 'upstream-tui-preserved'\nexit 7\n").unwrap();
    std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o755)).unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_cbgpu"))
        .args(["--continue", "--session", "existing-session"])
        .env("CBGPU_API_KEY", "cbgpu_ai_fixture_key")
        .env("CBGPU_AGENT_OPENCODE_PATH", engine)
        .current_dir(home.path())
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(7));
    assert_eq!(out.stdout, b"upstream-tui-preserved");
    assert!(!String::from_utf8_lossy(&out.stderr).contains("fixture_key"));
}
