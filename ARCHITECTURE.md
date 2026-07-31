# Architecture: gcloud-opencode

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

  infra-gcp/     @gco/infra-gcp   — all @google-cloud/* SDK wrappers
```

**Layer boundary rule:** `view/*` never imports from `model/firestore`, `model/secrets`, or `infra-gcp`. `controller/*` never imports from `view/*`. `model/*` never imports from `controller/*`.

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

At startup, `GoogleIdentity` (`infra-gcp/src/auth/GoogleIdentity.ts`) calls Google's userinfo endpoint with the ADC access token to resolve `{ email, name }`. If ADC is not configured the app exits immediately with an actionable error.

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

GCP project and region come from environment variables read by `infra-gcp/src/config.ts`:

```bash
GCLOUD_OPENCODE_PROJECT_ID=my-project   # required
GCLOUD_OPENCODE_REGION=us-central1      # optional, defaults to us-central1
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

Full MCP client management with OAuth. Tokens stored in `~/.local/share/opencode/mcp-auth.json` (XDG, mode 0o600). OAuth callback runs a local HTTP server.

### Tool (`controller/tool/src/`)

`ToolRegistry` — registration, discovery, materialization (builtins + MCP tools).  
`ToolPermissionEnforcer` — checks saved always/reject rules from `IPermissionRepository` before executing.

19 built-in tools: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Question`, `ApplyPatch`, `TodoWrite`, `Skill`, `HttpBody`, `ReadFilesystem`, `Lsp`, `McpWebsearch`, `ApplyUnifiedDiff`, `Agent`, `Task`.

### CLI (`controller/cli/src/`)

Yargs entry point wiring 15 commands. `bootstrap.ts` exports `ProductionLayer` and `TestLayer`.

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
