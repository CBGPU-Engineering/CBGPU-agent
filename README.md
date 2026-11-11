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

Install Node.js 22 or later, then:

```bash
npm install -g github:CBGPU-Engineering/CBGPU-agent
cbgpu login
cd path/to/your/project
cbgpu
```

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
node bin/cbgpu.mjs --help
```

The launcher and tests have been developed on Linux. OpenCode supplies its own
platform binaries; see its upstream documentation for supported systems.

## License

The CBGPU launcher and configuration are [Apache-2.0](./LICENSE).
The OpenCode engine remains [MIT](./OPENCODE-LICENSE), copyright its upstream
authors. Its source is [anomalyco/opencode](https://github.com/anomalyco/opencode).
Dependencies retain their own licenses.
