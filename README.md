# gcloud-opencode

A terminal-based AI coding assistant built with an MVC architecture and powered by Google Cloud. A focused rebuild of [opencode](https://github.com/opencode-ai/opencode) — single-user, no team features, four LLM providers, five GCP services.

## Features

- **Full terminal UI** — SolidJS + OpenTUI, keyboard-driven
- **MVC architecture** — strict layer boundaries enforced by ESLint
- **4 LLM providers** — Anthropic (Claude), Vertex AI (Gemini), DeepSeek, Ollama
- **Google Cloud backend** — Firestore sessions, Secret Manager credentials, Cloud Storage exports, Cloud Logging
- **MCP support** — Model Context Protocol client with OAuth
- **17 built-in tools** — bash, file ops, web, LSP, subagents, and more
- **Named agents** — configurable system prompts, models, and permissions per agent
- **Session history** — persistent across machines via Firestore

## Requirements

- [Bun](https://bun.sh) 1.3+
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) with a GCP project
- (Optional) [Ollama](https://ollama.ai) for local models

## Installation

```bash
git clone https://github.com/yourusername/gcloud-opencode
cd gcloud-opencode
bun install
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

Add a `gcp` block to your `~/.opencode/opencode.json`:

```jsonc
{
  "gcp": {
    "projectId": "your-gcp-project-id",
    "region": "us-central1"
  },
  "providers": {
    "anthropic": { "apiKey": "sk-ant-..." },
    "deepseek": { "apiKey": "sk-..." }
  }
}
```

> Vertex AI and Ollama require no API key — Vertex uses your GCP credentials, Ollama runs locally.

## Usage

```bash
# Open the interactive TUI
bun run dev

# Run a single prompt (non-interactive)
bun run dev -- run "explain this codebase"

# Session management
bun run dev -- session list
bun run dev -- session delete <id>

# Export a session to Cloud Storage
bun run dev -- export <sessionID>

# Provider and model management
bun run dev -- providers
bun run dev -- models

# MCP servers
bun run dev -- mcp list
bun run dev -- mcp add <name>
```

## Selecting a Model

```bash
bun run dev -- --model anthropic/claude-sonnet-4-6
bun run dev -- --model vertex-ai/gemini-2.0-flash-001
bun run dev -- --model deepseek/deepseek-chat
bun run dev -- --model ollama/llama3.2
```

## Agents

Configure agents in `opencode.json` or drop an `AGENTS.md` in your project root:

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

## Development

```bash
bun run dev          # run the TUI in development mode
bun test             # run tests (no GCP needed — uses in-memory layer)
bun run typecheck    # type check all packages
bun run lint         # lint all packages
```

## Architecture

```
packages/
  shared/       schema, llm providers
  model/        domain interfaces, Firestore repos, Secret Manager creds, test layer
  controller/   CLI commands, session runner, agent, MCP, tools
  view/         TUI (SolidJS + OpenTUI), CLI formatters
  cloud/    GCP SDK wrappers (Firestore, Storage, Secret Manager, Vertex AI, Logging)
```

See [`ARCHITECTURE_PLAN.md`](./ARCHITECTURE_PLAN.md) for the full design decisions and rationale.

## License

MIT
