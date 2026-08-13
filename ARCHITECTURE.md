# Architecture: lotus-code

Terminal-only AI coding assistant CLI. MVC monorepo backed by Google Cloud. Single-user, Bun + TypeScript + Effect-TS.

---

## Package Structure

```
packages/
  shared/
    schema/      @gco/schema       — entity types, event union, branded IDs
    llm/         @gco/llm          — LLM client + 4 provider adapters
    sdk/         @gco/sdk          — typed API client (SDK types)

  model/
    domain/      @gco/model-domain     — repository interfaces, no I/O
    firestore/   @gco/model-firestore  — Firestore implementations (user-scoped)
    secrets/     @gco/model-secrets    — Secret Manager credential repo
    test/        @gco/model-test       — in-memory implementations (no GCP needed)

  controller/
    cli/         @gco/controller-cli      — yargs entry, all CLI commands, bootstrap
    session/     @gco/controller-session  — LLM turn orchestration, compaction
    agent/       @gco/controller-agent    — agent registry + built-in agent prompts
    mcp/         @gco/controller-mcp      — MCP client management + OAuth
    tool/        @gco/controller-tool     — tool registry, execution, permission enforcement

  view/
    tui/         @gco/view-tui    — SolidJS + OpenTUI terminal UI
    cli/         @gco/view-cli    — plain-text formatters, table/color utils

  cloud/     @gco/cloud   — all @google-cloud/* SDK wrappers
```

**Layer boundary rule:** `view/*` never imports from `model/firestore`, `model/secrets`, or `cloud`. `controller/*` never imports from `view/*`. `model/*` never imports from `controller/*`.

---

## GCP Services

| Service | Purpose | Free tier |
|---|---|---|
| **Firestore** | Sessions, events, credentials, permissions, projects, workspaces | 1 GB, 50K reads / 20K writes per day |
| **Vertex AI** | Gemini models as a first-class LLM provider | $300 credit |
| **Secret Manager** | API keys for non-GCP LLM providers | 6 secret versions, 10K ops/month |
| **Cloud Storage** | Session exports, file attachments | 5 GB/month |
| **Cloud Logging** | Structured app logs | 50 GB/month |

---

## User Identity & Authentication

Authentication piggybacks on **Application Default Credentials (ADC)** — no separate login flow.

```bash
gcloud auth application-default login   # one-time setup
```

At startup, `GoogleIdentity` (`cloud/src/auth/GoogleIdentity.ts`) calls Google's userinfo endpoint with the ADC access token to resolve `{ email, name }`. If ADC is not configured the app exits immediately with an actionable error.

### Per-user Firestore namespacing

All collections are scoped under `/users/{email}/` — different Google accounts on the same GCP project have completely isolated data:

```
/users/{email}/sessions/{id}
  /users/{email}/sessions/{id}/events/{seq}
/users/{email}/credentials/{id}
/users/{email}/permissions/{id}
/users/{email}/projects/{id}
/users/{email}/workspaces/{id}
```

`GoogleIdentity` is a dependency of `FirestoreModelLayer`. All six Firestore repo implementations receive the email in their constructor and prefix every collection reference. The `TestLayer` provides a stub identity (`test@example.com`) so tests never need real credentials.

### Config

GCP project and region come from environment variables read by `cloud/src/config.ts`:

```bash
LOTUS_PROJECT_ID=my-project   # required
LOTUS_REGION=us-central1      # optional, defaults to us-central1
```

---

## Model Layer

### Repository interfaces (`model/domain/src/repositories/`)

```typescript
ISessionRepository    — get, list, create, update, archive
IEventRepository      — append, load, loadFromCompaction
ICredentialRepository — all, list, get, create, update, remove
IPermissionRepository — list, listForProject, save, remove, removeAllForProject
IProjectRepository    — get, getByWorktree, list, create, update
IWorkspaceRepository  — get, list, create, update, remove
```

### Firestore data model

```
/users/{email}/sessions/{sessionID}
  id, projectID, title, agent?, model?
  cost, tokens.{input, output, reasoning, cache.{read, write}}
  time.{created, updated, archived?}
  location.{directory}
  eventSeq: number           ← monotonic, incremented in each append transaction
  lastCompactionSeq: number  ← updated by append when a compaction.ended event is written

  /events/{seq padded to 20 digits}
    seq: number
    type: string             ← e.g. "session.next.tool.called"
    data: object             ← Effect Schema encoded payload
```

**Write strategy:** each `append` runs a single Firestore transaction — reads `eventSeq`, writes all event docs, updates `eventSeq` (and `lastCompactionSeq` if a `compaction.ended` event is present).

**Live-only events** (text deltas, reasoning deltas, tool input deltas) are never written to Firestore — only the final values (`text.ended`, `reasoning.ended`, `tool.called`, `tool.success/failed`) are persisted.

### In-memory test layer (`model/test/`)

Drop-in replacements for all repos using plain `Map`s. `bun test` uses these — no credentials or network required.

---

## Controller Layer

### Session (`controller/session/src/`)

**`SessionController`** — create, get, list, prompt, interrupt, resume, revert. `prompt()` appends a `session.next.prompt.admitted` event then fire-and-forgets `SessionRunner.run()`.

**`SessionRunner`** — the LLM turn loop:
1. Loads history from last compaction boundary via `eventRepo.loadFromCompaction()`
2. Projects events → `SessionMessage[]` via `projectMessages()`
3. Converts messages → LLM format via `toLLMMessages()`
4. Streams the LLM response, publishing durable events for each step
5. Executes tool calls via `ToolRegistry`, settles results back into the stream
6. Loops until `end_turn` or step limit (20)

**`SessionExporter`** / **`SessionImporter`** — marshal sessions to/from JSON/markdown, upload/download via `GCSStorage`.

### Session memory & compaction

Every turn is event-sourced into Firestore. On reload, `loadFromCompaction` starts from the last `lastCompactionSeq` so only the tail is replayed, not the full log.

**Compaction trigger conditions (both automatic):**

| Trigger | When | Action |
|---|---|---|
| Reactive | Provider returns a context-overflow error | Compact immediately, reset step to 1, retry the turn |
| Proactive | Input token count ≥ 100,000 after a turn | Compact before the next turn |

**What `runCompaction` does:**
1. Loads the full event log; projects to messages
2. Splits at the last 4 messages (kept verbatim as `recent`)
3. Formats older messages as text; includes `<previous-summary>` if a prior compaction exists
4. Calls the LLM with the `PROMPT_COMPACTION` system prompt (from `AgentRegistry`)
5. Writes `session.next.compaction.started` + `session.next.compaction.ended` events
6. The `compaction.ended` event carries `{ text: summary, recent: verbatimTail }`; the `append` transaction simultaneously updates `lastCompactionSeq` on the session doc

Compaction failures are swallowed (`Effect.catchCause(() => Effect.void)`) — the session continues with an oversized context rather than crashing.

**History reconstruction:** `projectMessages()` handles `session.next.compaction.ended` by emitting a `SessionMessage.Compaction` node. `toLLMMessages()` renders it as a `<conversation-checkpoint>` block containing the summary and recent verbatim context.

### Agent (`controller/agent/src/`)

**`AgentRegistry`** — loads agent definitions from config files and provides built-in agents:

| Agent | Purpose |
|---|---|
| `build` | Default coding agent |
| `explore` | Read-only codebase search |
| `plan` | Architecture and planning |
| `general` | General-purpose |
| `compaction` | Summarizes conversation history (hidden, no tools) |
| `title` | Generates session titles (hidden) |
| `summary` | Generates session summaries (hidden) |

### MCP (`controller/mcp/src/`)

Full MCP client management with OAuth. Tokens stored in `~/.local/share/lotus-code/mcp-auth.json` (XDG, mode 0o600). OAuth callback runs a local HTTP server.

### Tool (`controller/tool/src/`)

`ToolRegistry` — registration, discovery, materialization (builtins + MCP tools).  
`ToolPermissionEnforcer` — checks saved always/reject rules from `IPermissionRepository` before executing.

19 built-in tools: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Question`, `ApplyPatch`, `TodoWrite`, `Skill`, `HttpBody`, `ReadFilesystem`, `Lsp`, `McpWebsearch`, `ApplyUnifiedDiff`, `Agent`, `Task`.

### CLI (`controller/cli/src/`)

Yargs entry point wiring 15 commands. `bootstrap.ts` exports `ProductionLayer` and `TestLayer`.

---

## In-Process HTTP API (`tui-server.ts`)

When the TUI starts, an HTTP server binds to a random port on `localhost`. The port is printed at startup (`[tui-server] listening on http://localhost:<port>`). All responses are JSON unless noted.

### Health & Config

| Method | Path | Description |
|---|---|---|
| `GET` | `/global/health` | Returns `"OK"` |
| `GET` | `/global/event` | SSE stream — emits session events and lifecycle notifications |
| `GET` | `/config` | Current config `{ model, ...overrides }` |
| `PATCH` | `/config` | Merge body into config; persists `model` changes to `lotus-code.json` |
| `GET` | `/provider` | Provider list with model catalog and connection status |
| `GET` | `/provider/auth` | Provider auth methods |
| `GET` | `/path` | Resolved filesystem paths (home, state, config, worktree, directory) |
| `POST` | `/global/dispose` | Tear down the server |

### Sessions

| Method | Path | Description |
|---|---|---|
| `GET` | `/session` | List all sessions for the current project |
| `POST` | `/session` | Create a session — body: `{ title?, agent?, model?, directory? }` |
| `GET` | `/session/status` | Map of `{ sessionID → "running" \| "idle" }` |
| `GET` | `/session/:id` | Get a single session |
| `POST` | `/session/:id/prompt` | Submit a prompt — body: `{ text }` — LLM runs in background |
| `GET` | `/session/:id/message` | Full conversation history projected from events |
| `GET` | `/session/:id/diff` | `git status` for the session's working directory |
| `GET` | `/session/:id/todo` | Todo items (requires TodoService wiring — currently `[]`) |
| `POST` | `/session/:id/abort` | Interrupt the running LLM turn |

### Debug

| Method | Path | Description |
|---|---|---|
| `GET` | `/debug/session/:id/events` | Raw Firestore events for a session (use this to read LLM responses) |
| `POST` | `/debug/session/abort-all` | Abort all active sessions |

**Reading an LLM response:** After `POST /session/:id/prompt` returns, poll `GET /debug/session/:id/events` until you see a `session.next.text.ended` event — the assistant's reply is in `data.text`.

### Skills (Agents)

Skills are named agent definitions with a system prompt. They are persisted to `lotus-code.json` under the `agents` key and loaded at next startup.

| Method | Path | Description |
|---|---|---|
| `GET` | `/skill` | List registered tools as skills |
| `POST` | `/skill` | Create a new skill — see body below |
| `DELETE` | `/skill/:name` | Remove a skill from `lotus-code.json` |

**POST /skill body:**
```json
{
  "name": "reviewer",
  "system": "You are a senior code reviewer...",
  "model": "deepseek/deepseek-chat",
  "description": "Reviews code for correctness and style",
  "mode": "primary"
}
```
`mode` is `"primary"` (user-facing) or `"subagent"` (called by other agents). `model` is optional.

### MCP Servers

| Method | Path | Description |
|---|---|---|
| `GET` | `/mcp` | Live status of all configured MCP servers |
| `POST` | `/mcp` | Add and connect a new server — persists to `lotus-code.json` |
| `POST` | `/mcp/:name/connect` | Connect a pre-configured server |
| `DELETE` | `/mcp/:name` | Disconnect and remove from `lotus-code.json` |

**POST /mcp — local stdio server:**
```json
{
  "name": "filesystem",
  "type": "local",
  "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  "cwd": "/optional/working/dir",
  "environment": { "MY_VAR": "value" },
  "timeout": 30000
}
```

**POST /mcp — remote SSE server:**
```json
{
  "name": "my-api",
  "type": "remote",
  "url": "https://example.com/mcp",
  "headers": { "Authorization": "Bearer token" },
  "timeout": 30000
}
```

### Agents, Commands, Projects, VCS

| Method | Path | Description |
|---|---|---|
| `GET` | `/agent` | List configured agents |
| `GET` | `/command` | List available CLI commands with descriptions |
| `GET` | `/project` | List projects from Firestore |
| `GET` | `/project/current` | Current working directory as a project |
| `GET` | `/project/:id/directories` | Directories for a project |
| `GET` | `/vcs` | Git repo info `{ type, root, branch, commit }` |
| `GET` | `/vcs/status` | Parsed `git status --porcelain` — array of `{ file, staged, unstaged, untracked, status }` |
| `GET` | `/vcs/diff` | Raw diff text `{ diff }` — add `?staged=true` for staged diff |
| `GET` | `/lsp` | LSP status `{ running: false, servers: [] }` — not wired |
| `GET` | `/formatter` | Formatter status `{ running: false, formatters: [] }` — not wired |
| `GET` | `/permission` | Pending tool permission requests |
| `GET` | `/question` | Pending question requests |

**`ProductionLayer`** — `GcpConfig` → `FirestoreClient` + `GCSStorage` + `CloudLogger` + `GoogleIdentity` → `FirestoreModelLayer` + `SecretsModelLayer` → all controllers.

**`TestLayer`** — `TestModelLayer` (in-memory) + stub `GoogleIdentity` + stub `GCSStorage` → same controllers.

---

## Layer Assembly

```
ProductionLayer (bootstrap.ts)
├── GcpConfig.layer                  (env vars)
├── FirestoreClient.layer            (needs GcpConfig)
├── GoogleIdentity.layer             (needs GcpConfig)
├── GCSStorage.layer                 (needs GcpConfig)
├── CloudLogger.layer                (needs GcpConfig)
├── FirestoreModelLayer              (needs FirestoreClient + GoogleIdentity)
├── SecretsModelLayer                (needs SecretManagerClient)
├── vertexModelResolverLayer         (needs GcpConfig)
├── llmClientLayer
├── sessionControllerLayer           (needs SessionRepository + EventRepository + SessionRunner)
├── sessionRunnerLayer               (needs LLMClient + EventRepository + SessionRepository + ToolRegistry + ModelResolver)
├── agentLayer
├── mcpLayer + mcpAuthLayer
├── toolRegistryLayer
└── toolPermissionEnforcerLayer
```

Effect-TS resolves the dependency graph within `Layer.mergeAll` — no manual wiring order required.

---

## LLM Providers

Four providers, all accessed through `@gco/llm`:

| Provider | Model IDs | Auth |
|---|---|---|
| **Anthropic** | claude-* | API key via Secret Manager |
| **Vertex AI** | gemini-2.0-flash-001, gemini-2.5-pro-preview-06-05 | ADC (GCP) |
| **DeepSeek** | deepseek-* | API key via Secret Manager |
| **Ollama** | any local model | localhost, no auth |
