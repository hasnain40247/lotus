# gcloud-opencode

AI coding assistant CLI — terminal-only, single-user, MVC architecture backed by Google Cloud.

## Architecture

MVC monorepo built with Bun + TypeScript + Effect-TS. Full architecture spec is in `ARCHITECTURE_PLAN.md`.

```
packages/
  shared/       schema/, llm/           — foundation, no business logic
  model/        domain/, firestore/, secrets/, test/  — data layer
  controller/   cli/, session/, agent/, mcp/, tool/   — orchestration
  view/         tui/, cli/              — terminal output only
  infra-gcp/                            — all @google-cloud/* SDK wrappers
```

**Layer boundary rule:** `view/*` never imports from `model/firestore` or `infra-gcp`. `controller/*` never imports from `view/*`. `model/*` never imports from `controller/*`.

## LLM Providers

Four providers only: **Anthropic**, **Vertex AI** (Gemini via GCP), **DeepSeek**, **Ollama** (local).

## GCP Services

Five services: Firestore (sessions/events), Secret Manager (API keys), Cloud Storage (exports), Vertex AI (Gemini), Cloud Logging.

## GCP Setup

```bash
# One-time local auth — all @google-cloud/* SDKs pick this up automatically
gcloud auth application-default login

# Add to your opencode.json
{
  "gcp": {
    "projectId": "your-gcp-project-id",
    "region": "us-central1"
  }
}
```

## Development

```bash
bun install

# Run the TUI
bun run dev

# Run tests (uses in-memory model layer — no GCP needed)
bun test

# Type check all packages
bun run typecheck

# Lint
bun run lint
```

## Testing Without GCP

All controllers have an in-memory test layer in `packages/model/test/`. Tests wire `InMemorySessionRepository` etc. instead of Firestore — no credentials or network required.

```bash
bun test  # uses in-memory layer automatically
```

## Key Files

| File | Purpose |
|---|---|
| `ARCHITECTURE_PLAN.md` | Full architectural decisions and rationale |
| `packages/controller/cli/src/bootstrap.ts` | Effect Layer composition root (GCP vs test) |
| `packages/infra-gcp/src/vertex/VertexAiProvider.ts` | Gemini provider implementation |
| `packages/model/domain/src/repositories/` | Repository interfaces all implementations must satisfy |
| `packages/model/firestore/src/` | Firestore implementations of all repos |
| `packages/model/test/src/` | In-memory implementations for testing |

## Commands

```bash
gcloud-opencode                  # open TUI (default)
gcloud-opencode run "prompt"     # non-interactive single prompt
gcloud-opencode session list     # list sessions
gcloud-opencode session delete   # delete a session
gcloud-opencode export           # export session to Cloud Storage
gcloud-opencode import           # import a session
gcloud-opencode providers        # manage LLM provider auth
gcloud-opencode models           # list available models
gcloud-opencode agent list       # list configured agents
gcloud-opencode agent create     # create a new agent
gcloud-opencode mcp list         # list MCP servers
gcloud-opencode mcp add          # add an MCP server
gcloud-opencode mcp auth         # authenticate with an MCP server
gcloud-opencode upgrade          # upgrade to latest version
gcloud-opencode uninstall        # uninstall
```

## Effect-TS Patterns

Services use `Context.Service` and `Layer` for dependency injection:

```typescript
// Defining a service
export class SessionController extends Context.Service<SessionController>()(
  "SessionController",
  { effect: Effect.gen(function* () { ... }) }
) {}

// Composing layers
const appLayer = controllerLayer.pipe(Layer.provide(modelLayer))
```

## Agents

Defined in `opencode.json` under `agents` key or via `AGENTS.md` files in the project root.

```jsonc
{
  "agents": {
    "build": {
      "system": "You are a senior TypeScript engineer...",
      "model": "anthropic/claude-sonnet-4-6",
      "mode": "primary",
      "permissions": ["bash", "read", "edit", "glob", "grep"]
    }
  }
}
```

Built-in agents: `build` (default), `explore`, `plan`, `general`, `compaction`, `title`, `summary`.
