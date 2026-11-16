use cbgpu_agent_native::api::{StreamDecoder, model};
use cbgpu_agent_native::tools::{Redactor, secret_path};
use std::path::Path;
#[test]
fn models_do_not_fall_back_to_paid_providers() {
    assert!(model("gpt-4").is_err());
    assert_eq!(model("cbgpu/cbgpu-coder").unwrap(), "cbgpu-coder");
}
#[test]
fn streams_unicode_immediately_and_ignores_private_reasoning() {
    let mut decoder = StreamDecoder::default();
    let mut output = String::new();
    let frame = "data: {\"choices\":[{\"delta\":{\"content\":\"안녕\",\"reasoning_content\":\"private\"}}]}\n\n";
    for byte in frame.as_bytes() {
        decoder
            .push(&[*byte], &mut |s: &str| output.push_str(s))
            .unwrap();
    }
    assert_eq!(output, "안녕");
    decoder
        .push(
            b"data: {\"choices\":[{\"finish_reason\":\"stop\"}]}\n\n",
            &mut |s: &str| output.push_str(s),
        )
        .unwrap();
    assert_eq!(decoder.finish(&mut |_: &str| {}).unwrap().content, "안녕");
}
#[test]
fn partial_or_truncated_calls_are_never_executable() {
    for end in [
        "",
        "data: {\"choices\":[{\"finish_reason\":\"length\"}]}\n\n",
    ] {
        let mut d = StreamDecoder::default();
        d.push(b"data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"a\",\"function\":{\"name\":\"bash\",\"arguments\":\"{\"}}]}}]}\n\n",&mut |_:&str|{}).unwrap();
        if d.push(end.as_bytes(), &mut |_: &str| {}).is_ok() {
            assert!(d.finish(&mut |_: &str| {}).is_err());
        }
    }
}
#[test]
fn credentials_are_denied_and_output_redacted() {
    for path in [
        ".env",
        ".ssh/id_ed25519",
        "foo/credentials.json",
        "android/key.properties",
        "x.pem",
    ] {
        assert!(secret_path(Path::new(path)), "{path}");
    }
    let r = Redactor::new("cbgpu_ai_test_secret");
    let out = r.text("cbgpu_ai_test_secret https://password@host.test TOKEN");
    assert!(!out.contains("test_secret"));
    assert!(!out.contains("password@"));
}
#[test]
fn saved_keys_remain_private_and_bound_to_their_origin() {
    use cbgpu_agent_native::{api::ENDPOINT, credentials};
    let d = tempfile::tempdir().unwrap();
    let file = d.path().join("private/credentials.json");
    let key = "cbgpu_ai_fixture_key";
    credentials::save(&file, key, ENDPOINT).unwrap();
    assert_eq!(credentials::read(&file, ENDPOINT).unwrap(), key);
    assert!(credentials::read(&file, "https://evil.invalid/api/ai/v1").is_err());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(credentials::read(&file, ENDPOINT).is_err());
    }
}
#[test]
fn upstream_wrapper_preserves_full_engine_arguments_and_safe_provider_config() {
    use cbgpu_agent_native::engine::{arguments, config};
    assert_eq!(arguments(&[]), ["--agent", "cbgpu", "--pure"]);
    let args = vec![
        "--continue".into(),
        "--session".into(),
        "existing-session".into(),
    ];
    assert_eq!(&arguments(&args)[..3], args);
    let c = config(
        "https://cbgpu.com/api/ai/v1",
        Path::new("/project"),
        Path::new("/opt/cbgpu"),
    );
    assert_eq!(c["enabled_providers"], serde_json::json!(["cbgpu"]));
    assert_eq!(c["share"], "disabled");
    assert_eq!(c["autoupdate"], false);
    assert_eq!(c["permission"]["bash"], "ask");
    assert_eq!(c["permission"]["read"]["*.env"], "deny");
    assert_eq!(
        c["mcp"]["cbgpu-web"]["command"],
        serde_json::json!(["/opt/cbgpu", "web-mcp"])
    );
    assert!(
        c["agent"]["cbgpu"]["prompt"]
            .as_str()
            .unwrap()
            .contains("CBGPU_PROJECT_ROOT: /project")
    );
    assert!(!c.to_string().contains("cbgpu_ai_"));
}
#[tokio::test]
async fn actual_http_client_streams_and_sends_the_requested_model_effort() {
    use cbgpu_agent_native::api::{Client, Service};
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut req = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            let n = stream.read(&mut buf).await.unwrap();
            assert!(n > 0);
            req.extend_from_slice(&buf[..n]);
            if let Some(i) = req.windows(4).position(|w| w == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&req[..i]);
                let len = head
                    .lines()
                    .find_map(|l| {
                        l.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|v| v.trim().parse::<usize>().ok())
                    })
                    .unwrap();
                if req.len() >= i + 4 + len {
                    let body: serde_json::Value = serde_json::from_slice(&req[i + 4..]).unwrap();
                    assert_eq!(body["model"], "cbgpu-coder");
                    assert_eq!(body["reasoning_effort"], "high");
                    assert_eq!(body["stream"], true);
                    assert!(
                        head.to_ascii_lowercase()
                            .contains("authorization: bearer cbgpu_ai_fixture")
                    );
                    break;
                }
            }
        }
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"live\"}}]}\n\n").await.unwrap();
        stream.flush().await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        stream
            .write_all(b"data: {\"choices\":[{\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
            .await
            .unwrap();
    });
    let api = Client::new(
        &format!("http://{addr}/api/ai/v1"),
        "cbgpu_ai_fixture".into(),
    )
    .unwrap();
    let mut output = String::new();
    let answer = api
        .chat(
            &[json!({"role":"user","content":"hi"})],
            "cbgpu-coder",
            "high",
            &json!([]),
            &mut |s: &str| output.push_str(s),
        )
        .await
        .unwrap();
    assert_eq!(output, "live");
    assert_eq!(answer.content, "live");
    server.await.unwrap();
}
