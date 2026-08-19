# neko

AI coding assistant CLI — terminal-only, single-user, MVC architecture with local persistence.

## Architecture

MVC monorepo built with Bun + TypeScript + Effect-TS. Full architecture spec is in `ARCHITECTURE_PLAN.md`.

```
packages/
  shared/       schema/, llm/                             — foundation, no business logic
  model/        domain/, local/, test/                    — data layer
  controller/   cli/, session/, agent/, mcp/, tool/       — orchestration
  view/         tui/, cli/                                — terminal output only
```

**Layer boundary rule:** `view/*` never imports from `model/local`. `controller/*` never imports from `view/*`. `model/*` never imports from `controller/*`.

## LLM Providers

Three providers: **Anthropic**, **DeepSeek**, **OpenAI**, plus **Ollama** (local). API keys live in `neko.json` under `provider.{id}.apiKey`.

## Local storage

State lives under `$XDG_DATA_HOME/neko/` (defaults to `~/.local/share/neko/`):

```
~/.local/share/neko/
  ├─ neko.db                             # SQLite: sessions, projects, permissions
  └─ events/{sessionID}/{seq}.json       # append-only event stream, one file per event
```

Zero cloud calls. No auth setup. Delete the directory to reset.

## Development

```bash
bun install

# Run the TUI
bun run dev

# Run tests (uses in-memory model layer)
bun test

# Type check all packages
bun run typecheck

# Lint
bun run lint
```

## Key Files

| File | Purpose |
|---|---|
| `ARCHITECTURE_PLAN.md` | Full architectural decisions and rationale |
| `packages/controller/cli/src/bootstrap.ts` | Effect Layer composition root (prod vs test) |
| `packages/model/domain/src/repositories/` | Repository interfaces all implementations satisfy |
| `packages/model/local/src/` | SQLite + JSON event log implementations |
| `packages/model/local/src/db.ts` | Schema + migration runner |
| `packages/model/test/src/` | In-memory implementations for testing |

## Commands

```bash
neko                  # open TUI (default)
neko run "prompt"     # non-interactive single prompt
neko session list     # list sessions
neko session delete   # delete a session
neko providers        # manage provider API keys in neko.json
neko models           # list available models
neko agent list       # list configured agents
neko agent create     # create a new agent
neko mcp list         # list MCP servers
neko mcp add          # add an MCP server
neko mcp auth         # authenticate with an MCP server
neko db path          # print local storage paths
neko upgrade          # upgrade to latest version
neko uninstall        # uninstall
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

Defined in `neko.json` under `agents` key or via `AGENTS.md` files in the project root.

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
