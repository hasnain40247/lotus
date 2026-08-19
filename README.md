# Neko

A terminal-based AI pair programmer, built with an MVC architecture on Google Cloud. Single-user by design, four LLM providers, first-class MCP support.

<p align="center">
  <img src="./assets/image.png" alt="Neko running in a terminal" width="820" />
</p>

## Features

- **Full terminal UI** — SolidJS + OpenTUI, keyboard-driven, warm paper light theme and neutral dark theme
- **MVC architecture** — strict layer boundaries enforced by ESLint
- **4 LLM providers** — Anthropic (Claude), Vertex AI (Gemini), DeepSeek, Ollama
- **Google Cloud backend** — Firestore sessions, Secret Manager credentials, Cloud Storage exports, Cloud Logging
- **MCP support** — Model Context Protocol client with OAuth; MCP tools are merged into the LLM's tool catalog so the model can call them directly
- **Built-in tools** — bash, file ops, web, LSP, subagents, and more
- **Named agents** — configurable system prompts, models, and permissions per agent
- **Session history** — persistent across machines via Firestore
- **Slash commands** — `/agent`, `/mcp`, `/theme`, `/rename`, `/compact`, `/timeline`, and more
- **@ file mentions** — fuzzy-search files from the current project and drop them into your prompt inline

## Requirements

- [Bun](https://bun.sh) 1.3+
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) with a GCP project
- (Optional) [Ollama](https://ollama.ai) for local models

## Install

Two paths depending on how you plan to use Neko: install a standalone binary for daily use, or run from source for active development.

### Option 1: Install the binary (recommended for users)

Builds a single ~75 MB executable with the Bun runtime embedded. Once installed, `neko` runs in any terminal — no Bun required at invocation time.

```bash
git clone https://github.com/yourusername/neko
cd neko
bun install
bun run build

# System-wide install
sudo mv ./dist/neko /usr/local/bin/neko

# — or — user-only install (ensure ~/.local/bin is on your PATH)
mv ./dist/neko ~/.local/bin/neko

# Verify
neko --version
```

Cross-compile for other platforms with `BUILD_TARGET` and `BUILD_OUTFILE`:

```bash
BUILD_TARGET=bun-darwin-x64   BUILD_OUTFILE=./dist/neko-darwin-x64   bun run build
BUILD_TARGET=bun-linux-x64    BUILD_OUTFILE=./dist/neko-linux-x64    bun run build
BUILD_TARGET=bun-linux-arm64  BUILD_OUTFILE=./dist/neko-linux-arm64  bun run build
BUILD_TARGET=bun-windows-x64  BUILD_OUTFILE=./dist/neko.exe          bun run build
```

Each target produces a self-contained binary — copy it to a matching machine and run.

### Option 2: Run from source (recommended for development)

Bypasses the build step so your edits are picked up on the next launch. Requires Bun on the machine at all times.

```bash
git clone https://github.com/yourusername/neko
cd neko
bun install

# Open the TUI
bun run dev

# Any subcommand — pass through with `--`
bun run dev -- run "explain this codebase"
bun run dev -- session list
```

If you'd rather still type `neko` (instead of `bun run dev`) while developing, drop a shell shim on your PATH that execs the source. Since it doesn't rebuild, your edits show up on the next `neko` invocation:

```bash
cat > ~/.local/bin/neko <<EOF
#!/usr/bin/env bash
exec bun run --preload $(pwd)/preload.ts $(pwd)/packages/controller/cli/src/index.ts "\$@"
EOF
chmod +x ~/.local/bin/neko
```

### Uninstall

```bash
rm $(which neko)
rm -rf ~/.local/share/neko    # local session data
```

## GCP Setup

```bash
# Authenticate with GCP
gcloud auth application-default login

# Enable required APIs
gcloud services enable firestore.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  aiplatform.googleapis.com \
  logging.googleapis.com
```

Add a `gcp` block to your project's `neko.json`:

```jsonc
{
  "gcp": {
    "projectId": "your-gcp-project-id",
    "region": "us-central1"
  },
  "provider": {
    "anthropic": { "apiKey": "sk-ant-..." },
    "deepseek":  { "apiKey": "sk-..." }
  }
}
```

> Vertex AI and Ollama require no API key — Vertex uses your GCP credentials, Ollama runs locally.

## Usage

`neko` opens the TUI in the current directory. Open multiple terminals for parallel sessions — each instance binds to its own ephemeral port and shares state via the local SQLite backend.

```bash
# Open the interactive TUI in the current directory
neko

# Open the TUI in a specific project directory
neko ~/code/some-project

# Run a single prompt (non-interactive)
neko run "explain this codebase"

# Session management
neko session list
neko session delete <id>

# Provider and model management
neko providers
neko models

# MCP servers
neko mcp list
neko mcp add <name>

# Inspect local storage
neko db path
```

## Selecting a Model

```bash
neko --model anthropic/claude-sonnet-4-6
neko --model vertex-ai/gemini-2.0-flash-001
neko --model deepseek/deepseek-chat
neko --model ollama/llama3.2
```

## Slash Commands

Type `/` in the TUI to browse. Highlights:

- `/agent` — list, switch to, delete, or create a new agent (name → description → mode)
- `/mcp` — list connected MCP servers (with status), reconnect, delete, or add a new local server (name → command → env)
- `/theme` — pick Light or Dark; stored in `~/.neko/config.json` (restart to apply)
- `/rename` — rename the current session
- `/compact` — summarize the session to shrink the context window
- `/timeline` — jump to a message in the transcript

## Agents

Configure agents in `neko.json`, drop an `AGENTS.md` in your project root, or create them interactively via `/agent`:

```jsonc
{
  "agents": {
    "build": {
      "system": "You are a senior TypeScript engineer focused on correctness and simplicity.",
      "model": "anthropic/claude-sonnet-4-6",
      "permissions": ["bash", "read", "edit", "glob", "grep"]
    },
    "reviewer": {
      "system": "You review code for security issues and performance problems only.",
      "model": "vertex-ai/gemini-2.5-pro-preview-06-05",
      "mode": "subagent",
      "permissions": ["read", "glob", "grep"]
    }
  }
}
```

Built-in agents: `build` (default), `plan`, `explore`, `general`, plus the internal `compaction` / `title` / `summary` helpers.

## MCP Servers

Local (subprocess) or remote (URL). Add via `/mcp` or by editing `neko.json`:

```jsonc
{
  "mcp": {
    "memory": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-memory"],
      "environment": {
        "MEMORY_FILE_PATH": "/absolute/path/to/memory.json"
      }
    },
    "github": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
      "environment": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    }
  }
}
```

Connected servers' tools appear directly in the LLM's tool catalog (namespaced `{server}_{tool}`), so the model can call them like any built-in.

## Development

See [Install > Option 2](#option-2-run-from-source-recommended-for-development) for launching the TUI from source. The other useful commands:

```bash
bun test             # run tests (uses in-memory model layer, no external services)
bun run typecheck    # type check all packages
bun run lint         # lint all packages
```

Runtime logs (runner traces, tui-server requests) are written to `~/.local/share/neko/neko.log` while the TUI is running, so they don't corrupt the render. Tail that file to debug.

## Architecture

```
packages/
  shared/       schema, llm providers, sdk
  model/        domain interfaces, Firestore repos, Secret Manager creds, test layer
  controller/   CLI commands, session runner, agent, MCP, tools
  view/         TUI (SolidJS + OpenTUI), CLI formatters
  cloud/        GCP SDK wrappers (Firestore, Storage, Secret Manager, Vertex AI, Logging)
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design decisions and rationale.

## License

MIT
