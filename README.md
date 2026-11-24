# CBGPU Agent

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![OpenCode](https://img.shields.io/badge/Engine-OpenCode%201.19.5-191F28)](https://github.com/anomalyco/opencode)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-D22128?logo=apache&logoColor=white)](./LICENSE)

CBGPU Agent is a terminal coding assistant connected to the school's local AI
service. It uses the MIT-licensed **OpenCode** engine, with CBGPU models,
account-scoped API keys and approval prompts for edits and shell commands.
It can inspect a project, explain code, propose changes and run checks after approval. For a fix, it reviews the diff, runs the relevant checks with approval, and reports which checks passed, failed, or could not run.

The project files and commands stay on the computer running the CLI. Selected
text, tool descriptions and tool results are sent to the CBGPU API for inference.
Inference uses unreserved school GPUs and may wait or pause for student reservations.
This is not Anthropic Claude Code and does not include a Claude subscription.

## Getting started

Install Node.js 22.18 or later, then:

```bash
npm install -g github:CBGPU-Engineering/CBGPU-agent
cbgpu login
cd path/to/your/project
cbgpu
```

### Install from GitHub Packages

If you have access to the organization's npm package, use the GitHub registry.
Authenticate using a GitHub personal access token with `read:packages` and
keep it in your user npm configuration.

```bash
npm login --scope=@cbgpu-engineering --auth-type=legacy --registry=https://npm.pkg.github.com
npm install -g @cbgpu-engineering/agent@0.1.0
cbgpu --help
```

The GitHub installation command above also works without package registry
access. Maintainers can publish a new, unused version by running **Publish
GitHub npm package** from the repository's Actions tab on `main`.

Create a key at [CBGPU AI → API](https://cbgpu.com/ai?tab=api). `cbgpu login`
asks for it without echoing it and saves it under
`~/.config/cbgpu-agent/credentials.json` with permissions `600`.
Keep the key out of source control, shell command arguments and shared screenshots.

The interactive agent asks before editing files or running shell commands. Review
the proposal before accepting it. For a read-only question from a terminal:

```bash
cbgpu run "Read README.md and explain how to run this project."
cbgpu models
cbgpu --model cbgpu/cbgpu-pro
```

Use the interactive `cbgpu` command when you need to approve edits or commands.
`cbgpu logout` removes the locally saved key; revoke it on the website to disable
it everywhere. An API key only grants inference, not access to the website's
private conversations, research notes, user files or host shell.

## Models

| Model | Purpose |
| --- | --- |
| `cbgpu/cbgpu-chat` | General conversation, Qwen2.5 7B |
| `cbgpu/cbgpu-coder` | Coding and tool proposals, Qwen2.5 Coder 7B; default |
| `cbgpu/cbgpu-pro` | Longer-form writing and analysis, Qwen2.5 14B |
| `cbgpu/cbgpu-oss` | Native reasoning and tool proposals, GPT-OSS 20B |

These are local models with an 8,192-token context window and up to 2,048 output
tokens per call (4,096 for GPT-OSS). They can make mistakes. Tool proposals do not execute on the
CBGPU server: the local OpenCode engine checks permissions and runs approved tools.
The API streams real visible-answer deltas during inference, with keep-alive comments while queued.
Tool proposals are delivered after validation. `reasoning_effort` accepts low, medium or high; GPT-OSS uses native reasoning and Qwen high runs a draft and review pass.

## Web tools

The bundled read-only MCP server offers `web_search` and `read_web_page` through
the authenticated CBGPU API. Queries are sent to DuckDuckGo, and source pages are
read without authentication or browser JavaScript. Internal/private addresses,
redirects into private networks and credential-bearing URLs are blocked.
OpenCode asks before these tool calls under the default permission policy.
Treat search results as reference material and check the original sources.

## Configuration and boundaries

The launcher enables only the CBGPU provider and disables automatic model-provider
fallback, public session sharing, automatic engine updates and external plugins.
Environment variable `CBGPU_API_KEY` can replace the saved key; do not put it in
project files. `CBGPU_BASE_URL` explicitly selects another HTTPS endpoint, or a
loopback HTTP endpoint for local tests. No secret is included in the generated
project/provider configuration.

Defaults require approval for edits, shell commands and paths outside the project.
Credential-like files (`*.env`, `*.pem`, `*.key`, SSH private keys) are denied.
These are agent permissions, not an operating-system sandbox. A command you
approve can have the same privileges as your terminal account. Review repository
instructions and commands before allowing them.

## Development

```bash
npm ci
npm test
npm run build
node dist/bin/cbgpu.js --help
```

The launcher and tests have been developed on Linux. OpenCode supplies its own
platform binaries; see its upstream documentation for supported systems.

## License

The CBGPU launcher and configuration are [Apache-2.0](./LICENSE).
The OpenCode engine remains [MIT](./OPENCODE-LICENSE), copyright its upstream
authors. Its source is [anomalyco/opencode](https://github.com/anomalyco/opencode).
Dependencies retain their own licenses.


The maintained CLI, local web MCP bridge, configuration and tests use strict
TypeScript. `npm run check` validates every source and `npm run build` emits the
Node.js distribution into ignored `dist/` files. Installed commands run compiled
output, so they do not rely on TypeScript stripping inside `node_modules`.

## Native Rust candidate

The candidate moves CBGPU's own authentication, provider configuration and
process supervision into Rust. Its default still launches the pinned MIT-licensed
OpenCode dependency, preserving the existing TUI, sessions, LSP and extended
commands. OpenCode itself remains upstream software; it has not been rewritten
in Rust. The existing npm entry is unchanged until cross-platform validation and
release review.

```bash
cargo test --locked
cargo clippy --all-targets --locked -- -D warnings
npm run build:native
node dist/bin/native.js --help
node dist/bin/native.js login
node dist/bin/native.js
node dist/bin/native.js --native
node dist/bin/native.js --native run "Read README.md and explain this project"
```

The build packages only the current OS/architecture, includes Rust dependency
license texts and records the executable's SHA-256. The thin TypeScript launcher
resolves the installed OpenCode executable, verifies the native artifact hash and
never downloads executables. Native CI builds on Linux, macOS and Windows. No
package is published by building the candidate.

`--native` explicitly selects the experimental all-native coding loop. It talks
directly to CBGPU's streaming API and implements eight tools and approvals in
Rust. It supports the four CBGPU models, `--effort low|medium|high`, immediate
visible-answer streaming, validated incremental tool calls, read-only `run` and
interactive changes. Each task starts a fresh conversation with at most twelve
model/tool rounds. This mode has text prompts rather than OpenCode's full TUI;
OpenCode session persistence/resume, LSP and slash commands remain available in
the default upstream mode.

The native loop defaults to denying approvals. Edits require a prior read and an
unchanged file; staged writes preserve permissions. Credential paths/private
keys are denied, known secrets are redacted from proposals/results, and saved
keys are bound to the API origin. Incomplete or truncated inference cannot
execute partial tools. It reports actual changed files and command exit codes.

These are application safeguards, not an OS sandbox. Approved shell commands
have the current user's permissions. Review commands before approving them and
use a restricted account/container for untrusted projects. There is no automatic
publishing, paid-provider fallback or added telemetry. `web-mcp` exposes only the
two authenticated public web tools and never local files or shell commands.

Native review CI also runs Linux ARM64 and Apple Silicon alongside the three
x64 targets. Successful jobs upload immutable archives with an executable,
checksum launcher, Apache and OpenCode licenses, Rust dependency notices and
exact source/workflow metadata. `npm run package:native` verifies an extracted
archive and rejects a tampered checksum. These archives do not bundle the
upstream OpenCode executable: the npm dependency provides it for default TUI
mode. Standalone Rust users can explicitly set an absolute
`CBGPU_AGENT_OPENCODE_PATH` to their installed upstream executable, or select
`--native` for the experimental independent engine. No executable is downloaded
by the candidate launcher. Unsupported native platforms keep the existing npm
command; native activation and package publication require release review.

## Install OpenClaw or Hermes with CBGPU

Run the setup program from a desktop session with Node.js 22.18 or newer.

```bash
cbgpu setup
```

The setup opens a local browser window on Windows, macOS, and Linux. Select an
agent, create an API key from [CBGPU AI](https://cbgpu.com/ai?tab=api), then
check the available models. Qwen3.8 is selected first when the API reports a
compatible model. OpenClaw needs 16,000 context tokens. Hermes needs 64,000.
OpenClaw computer use additionally requires a model with image input.

Each agent uses a separate CBGPU profile. Choose the access you need for files,
terminal, browser, desktop, scheduled work, and messaging. Terminal and desktop
access can reach data available to the operating system user. Stop the agent in
the setup window when you need to revoke a running session's access.

Enable **로그인·계정 만들기** if you want the agent to sign in or submit signup
forms for apps and sites you name, including new services. The selection adds
instructions to the profile workspace. Browser or desktop access supplies the
actual controls. Hermes can use its local credential vault for supported sites.
Complete credential entry and provider verification in the app or site when
they require your input.

On Linux and macOS, Hermes can use session-only sudo authentication when shell
access is enabled. Enter the password into the local setup window when starting
Hermes. The installer passes it to the running process. Hermes still applies
its command approval settings.

Telegram setup uses a bot from [BotFather](https://t.me/BotFather) and your
numeric Telegram user ID. The installer checks the bot's identity. Start the
agent and open a private conversation with that bot. The computer must stay
online to receive messages.

Desktop control follows the operating system's permissions. Follow the
[OpenClaw computer-use guide](https://docs.openclaw.ai/nodes/computer-use) or the
[Hermes computer-use guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/computer-use)
to grant the appropriate permissions and run the platform diagnostics.
