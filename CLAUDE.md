# lotus-code

AI coding assistant CLI — terminal-only, single-user, MVC architecture backed by Google Cloud.

## Architecture

MVC monorepo built with Bun + TypeScript + Effect-TS. Full architecture spec is in `ARCHITECTURE_PLAN.md`.

```
packages/
  shared/       schema/, llm/           — foundation, no business logic
  model/        domain/, firestore/, secrets/, test/  — data layer
  controller/   cli/, session/, agent/, mcp/, tool/   — orchestration
  view/         tui/, cli/              — terminal output only
  cloud/                            — all @google-cloud/* SDK wrappers
```

**Layer boundary rule:** `view/*` never imports from `model/firestore` or `cloud`. `controller/*` never imports from `view/*`. `model/*` never imports from `controller/*`.

## LLM Providers

Four providers only: **Anthropic**, **Vertex AI** (Gemini via GCP), **DeepSeek**, **Ollama** (local).

## GCP Services

Five services: Firestore (sessions/events), Secret Manager (API keys), Cloud Storage (exports), Vertex AI (Gemini), Cloud Logging.

## GCP Setup

```bash
# One-time local auth — all @google-cloud/* SDKs pick this up automatically
gcloud auth application-default login

# Add to your lotus-code.json
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
| `packages/cloud/src/vertex/VertexAiProvider.ts` | Gemini provider implementation |
| `packages/model/domain/src/repositories/` | Repository interfaces all implementations must satisfy |
| `packages/model/firestore/src/` | Firestore implementations of all repos |
| `packages/model/test/src/` | In-memory implementations for testing |

## Commands

```bash
lotus-code                  # open TUI (default)
lotus-code run "prompt"     # non-interactive single prompt
lotus-code session list     # list sessions
lotus-code session delete   # delete a session
lotus-code export           # export session to Cloud Storage
lotus-code import           # import a session
lotus-code providers        # manage LLM provider auth
lotus-code models           # list available models
lotus-code agent list       # list configured agents
lotus-code agent create     # create a new agent
lotus-code mcp list         # list MCP servers
lotus-code mcp add          # add an MCP server
lotus-code mcp auth         # authenticate with an MCP server
lotus-code upgrade          # upgrade to latest version
lotus-code uninstall        # uninstall
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

Defined in `lotus-code.json` under `agents` key or via `AGENTS.md` files in the project root.

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
