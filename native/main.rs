use cbgpu_agent_native::{
    Failure, Result,
    agent::Agent,
    api::{Client, ENDPOINT, Service},
    credentials,
    tools::{Approval, Deny, Redactor, Workspace},
    web,
};
use std::{
    io::{IsTerminal, Write},
    sync::Arc,
};
struct Terminal;
#[async_trait::async_trait]
impl Approval for Terminal {
    async fn allow(&self, description: &str) -> bool {
        if !std::io::stdin().is_terminal() {
            return false;
        }
        eprintln!("\n{description}\nApprove this action? [y/N]");
        let mut answer = String::new();
        std::io::stdin().read_line(&mut answer).is_ok()
            && ["y", "yes"].contains(&answer.trim().to_ascii_lowercase().as_str())
    }
}
fn main() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("runtime");
    let result = runtime.block_on(run());
    runtime.shutdown_timeout(std::time::Duration::from_secs(1));
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1)
    }
}
async fn run() -> Result<()> {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let native = args.first().is_some_and(|s| s == "--native");
    if native {
        args.remove(0);
    }
    let command = args.first().map(String::as_str).unwrap_or("");
    if ["--help", "help"].contains(&command) {
        println!(
            "CBGPU Agent · Rust launcher / OpenCode engine\n\ncbgpu login             Save a CBGPU AI key privately\ncbgpu                   Interactive coding agent with approval prompts\ncbgpu run \"task\"         Run a coding task with OpenCode\ncbgpu models            List CBGPU models\ncbgpu --model cbgpu/cbgpu-pro\ncbgpu logout            Remove only the local saved key\ncbgpu web-mcp           Read-only web MCP stdio\n\ncbgpu --native          Experimental native coding engine\ncbgpu --native run \"task\" Read-only native task\n\nDefault preserves OpenCode TUI/session/LSP. No paid-provider fallback."
        );
        return Ok(());
    }
    let base = crate_endpoint()?;
    let file = credentials::path()?;
    if command == "logout" {
        credentials::remove(&file)?;
        println!("Local key removed. Revoke it on https://cbgpu.com/ai?tab=api if needed.");
        return Ok(());
    }
    if command == "login" {
        if args.len() != 1 || !std::io::stdin().is_terminal() || !std::io::stderr().is_terminal() {
            return Err(Failure::new(
                "Run cbgpu login in an interactive terminal. Never pass or pipe an API key.",
            ));
        }
        let key = rpassword::prompt_password("CBGPU API key (hidden): ")
            .map_err(|_| Failure::new("Private terminal input unavailable."))?;
        let key = key.trim();
        if !credentials::valid(key) {
            return Err(Failure::new("Use an API key from CBGPU AI → API."));
        }
        Client::new(&base, key.into())?.models().await?;
        credentials::save(&file, key, &base)?;
        println!("Connected to CBGPU. Run cbgpu inside your project.");
        return Ok(());
    }
    let key = std::env::var("CBGPU_API_KEY")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| credentials::read(&file, &base).ok());
    let key = if command == "web-mcp" {
        key.unwrap_or_default()
    } else {
        key.ok_or_else(|| {
            Failure::new("Run cbgpu login first. Create a key at https://cbgpu.com/ai?tab=api")
        })?
    };
    if !key.is_empty() && !credentials::valid(&key) {
        return Err(Failure::new("Invalid CBGPU API key."));
    }
    let client = Client::new(&base, key.clone())?;
    if command == "models" {
        let models = client.models().await?;
        println!("{}", serde_json::to_string_pretty(&models).unwrap());
        return Ok(());
    }
    if command == "web-mcp" {
        let redactor = Redactor::new(&key);
        return web::serve(&client, &redactor)
            .await
            .map_err(|_| Failure::new("Web MCP connection closed."));
    }
    if !native {
        let code = cbgpu_agent_native::engine::launch(&args, &base, &key).await?;
        if code != 0 {
            std::process::exit(code);
        }
        return Ok(());
    }
    let mut model = "cbgpu-coder".to_owned();
    let mut effort = "medium".to_owned();
    let mut prompt = Vec::new();
    let mut i = 0;
    let read_only = command == "run";
    if read_only {
        i = 1;
    }
    while i < args.len() {
        match args[i].as_str() {
            "--model" | "-m" => {
                i += 1;
                model = cbgpu_agent_native::api::model(
                    args.get(i).ok_or_else(|| Failure::new("Model required."))?,
                )?;
            }
            "--effort" => {
                i += 1;
                effort = args
                    .get(i)
                    .ok_or_else(|| Failure::new("Effort required."))?
                    .clone();
            }
            value if read_only => prompt.push(value.to_owned()),
            _ => {
                return Err(Failure::new(
                    "Unsupported legacy engine option. Use cbgpu --help; the native candidate is independent of OpenCode.",
                ));
            }
        }
        i += 1;
    }
    if !["low", "medium", "high"].contains(&effort.as_str()) {
        return Err(Failure::new("Use reasoning effort low, medium or high."));
    }
    let root =
        std::env::current_dir().map_err(|_| Failure::new("Project directory unavailable."))?;
    let approval: Arc<dyn Approval> = if read_only {
        Arc::new(Deny)
    } else {
        Arc::new(Terminal)
    };
    let workspace = Workspace::new(&root, approval, &key, read_only)?;
    let agent = Agent {
        service: &client,
        workspace: &workspace,
        model,
        effort,
    };
    let mut output = |text: &str| {
        print!("{text}");
        let _ = std::io::stdout().flush();
    };
    if read_only {
        let task = prompt.join(" ");
        if task.is_empty() {
            return Err(Failure::new("Provide a read-only task after cbgpu run."));
        }
        let report = agent.task(&task, &mut output).await?;
        footer(&report);
        return Ok(());
    }
    if !std::io::stdin().is_terminal() {
        return Err(Failure::new(
            "Use an interactive terminal, or cbgpu run for a read-only task.",
        ));
    }
    println!(
        "CBGPU Agent · {} · {}\nEdits, commands and web calls require approval. /quit to exit.",
        agent.model,
        root.display()
    );
    loop {
        print!("\n> ");
        std::io::stdout()
            .flush()
            .map_err(|_| Failure::new("Terminal unavailable."))?;
        let mut task = String::new();
        if std::io::stdin()
            .read_line(&mut task)
            .map_err(|_| Failure::new("Terminal input unavailable."))?
            == 0
        {
            break;
        }
        let task = task.trim();
        if ["/quit", "/exit"].contains(&task) {
            break;
        }
        if task.is_empty() {
            continue;
        }
        match agent.task(task, &mut output).await {
            Ok(report) => footer(&report),
            Err(error) => eprintln!("\n{error}"),
        }
    }
    Ok(())
}
fn crate_endpoint() -> Result<String> {
    cbgpu_agent_native::api::endpoint(
        &std::env::var("CBGPU_BASE_URL").unwrap_or_else(|_| ENDPOINT.into()),
    )
}
fn footer(report: &cbgpu_agent_native::agent::Report) {
    println!();
    if !report.complete {
        eprintln!("Step limit reached; unfinished work was not claimed as complete.");
    }
    if !report.changed.is_empty() {
        eprintln!("Changed files: {}", report.changed.join(", "));
    }
    for (command, exit) in &report.checks {
        eprintln!(
            "Executed: {command} · exit {}",
            exit.map(|n| n.to_string())
                .unwrap_or_else(|| "interrupted".into())
        );
    }
    if report.checks.is_empty() {
        eprintln!("No shell checks were executed.");
    }
    if report.denied > 0 {
        eprintln!("Denied actions: {}", report.denied);
    }
}
