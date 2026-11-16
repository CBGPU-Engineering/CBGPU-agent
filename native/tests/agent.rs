use cbgpu_agent_native::{
    Result,
    agent::Agent,
    api::{Answer, FunctionCall, Service, ToolCall},
    tools::{Approval, Deny, Workspace},
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
struct Mock {
    replies: Mutex<Vec<Answer>>,
}
#[async_trait::async_trait]
impl Service for Mock {
    async fn chat(
        &self,
        _: &[Value],
        _: &str,
        _: &str,
        _: &Value,
        on: &mut (dyn for<'s> FnMut(&'s str) + Send),
    ) -> Result<Answer> {
        let a = self.replies.lock().unwrap().remove(0);
        on(&a.content);
        Ok(a)
    }
    async fn models(&self) -> Result<Value> {
        Ok(json!({}))
    }
    async fn web(&self, _: &str, _: &Value) -> Result<Value> {
        panic!("unexpected web call")
    }
}
struct Yes;
#[async_trait::async_trait]
impl Approval for Yes {
    async fn allow(&self, _: &str) -> bool {
        true
    }
}
fn call(name: &str, args: Value) -> Answer {
    Answer {
        content: String::new(),
        tool_calls: vec![ToolCall {
            id: "call1".into(),
            kind: "function".into(),
            function: FunctionCall {
                name: name.into(),
                arguments: args.to_string(),
            },
        }],
    }
}
fn mock(replies: Vec<Answer>) -> Mock {
    Mock {
        replies: Mutex::new(replies),
    }
}
#[tokio::test]
async fn read_edit_and_check_are_real_and_reported() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("app.ts"), "old\r\n").unwrap();
    let ws = Workspace::new(dir.path(), Arc::new(Yes), "cbgpu_ai_fake", false).unwrap();
    let api = mock(vec![
        call("read", json!({"filePath":"app.ts"})),
        call(
            "edit",
            json!({"filePath":"app.ts","oldString":"old\n","newString":"new\n"}),
        ),
        call("bash", json!({"command":"exit 7"})),
        Answer {
            content: "done".into(),
            ..Default::default()
        },
    ]);
    let a = Agent {
        service: &api,
        workspace: &ws,
        model: "cbgpu-coder".into(),
        effort: "medium".into(),
    };
    let mut output = String::new();
    let report = a
        .task("change old to new", &mut |s: &str| output.push_str(s))
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("app.ts")).unwrap(),
        "new\r\n"
    );
    assert_eq!(report.changed, vec!["app.ts"]);
    assert_eq!(report.checks[0].1, Some(7));
    assert!(report.complete);
    assert_eq!(output, "done");
}
#[tokio::test]
async fn readonly_and_unread_edits_never_mutate_files() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("a.ts");
    std::fs::write(&path, "old").unwrap();
    let api = mock(vec![]);
    for (approved, read_only) in [(false, false), (true, true)] {
        let approval: Arc<dyn Approval> = if approved {
            Arc::new(Yes)
        } else {
            Arc::new(Deny)
        };
        let ws = Workspace::new(d.path(), approval, "", read_only).unwrap();
        assert!(
            ws.execute(&api, "write", &json!({"filePath":"new.ts","content":"new"}))
                .await
                .is_err()
        );
        assert!(!d.path().join("new.ts").exists());
        assert!(
            ws.execute(
                &api,
                "edit",
                &json!({"filePath":"a.ts","oldString":"old","newString":"new"})
            )
            .await
            .is_err()
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
    }
}
#[tokio::test]
async fn concurrent_changes_and_secret_reads_are_rejected() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("a.ts");
    std::fs::write(&path, "old").unwrap();
    std::fs::write(d.path().join(".env"), "SECRET=private").unwrap();
    let api = mock(vec![]);
    let ws = Workspace::new(d.path(), Arc::new(Yes), "", false).unwrap();
    ws.execute(&api, "read", &json!({"filePath":"a.ts"}))
        .await
        .unwrap();
    std::fs::write(&path, "someone else's edit").unwrap();
    assert!(
        ws.execute(&api, "write", &json!({"filePath":"a.ts","content":"new"}))
            .await
            .is_err()
    );
    assert!(
        ws.execute(&api, "read", &json!({"filePath":".env"}))
            .await
            .is_err()
    );
    assert_eq!(
        std::fs::read_to_string(path).unwrap(),
        "someone else's edit"
    );
}
#[cfg(unix)]
#[tokio::test]
async fn symlinks_do_not_bypass_external_access_or_secret_rules() {
    let d = tempfile::tempdir().unwrap();
    let external = tempfile::tempdir().unwrap();
    std::fs::write(
        external.path().join("outside.ts"),
        "private external project",
    )
    .unwrap();
    std::os::unix::fs::symlink(external.path().join("outside.ts"), d.path().join("link.ts"))
        .unwrap();
    std::os::unix::fs::symlink(
        external.path().join("missing"),
        d.path().join("dangling.ts"),
    )
    .unwrap();
    let api = mock(vec![]);
    let ws = Workspace::new(d.path(), Arc::new(Deny), "", false).unwrap();
    assert!(
        ws.execute(&api, "read", &json!({"filePath":"link.ts"}))
            .await
            .is_err()
    );
    assert!(
        ws.execute(
            &api,
            "write",
            &json!({"filePath":"dangling.ts","content":"no"})
        )
        .await
        .is_err()
    );
    assert!(!external.path().join("missing").exists());
}
#[tokio::test]
async fn invalid_timeout_does_not_execute_command() {
    let d = tempfile::tempdir().unwrap();
    let api = mock(vec![]);
    let ws = Workspace::new(d.path(), Arc::new(Yes), "", false).unwrap();
    assert!(
        ws.execute(
            &api,
            "bash",
            &json!({"command":"echo unsafe > touched","timeout":0})
        )
        .await
        .is_err()
    );
    assert!(!d.path().join("touched").exists());
    assert!(
        ws.execute(&api, "read", &json!({"filePath":"missing","unknown":true}))
            .await
            .is_err()
    );
}
