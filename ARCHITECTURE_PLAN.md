# Architecture Plan: gcloud-opencode (MVC + Google Cloud Replica)

## Context

This plan creates a terminal-only replica of the `opencode-cli` project (a 12-package Bun monorepo AI coding assistant CLI) with two key changes:
1. **Strict MVC design pattern** — the existing "god package" structure is broken into clear Model / View / Controller layers with enforced boundaries
2. **Google Cloud services** — replaces local SQLite, file-based credentials, in-process event bus, and plain logging with managed GCP equivalents, staying within the $300 free-credit window

All CLI commands (minus `plug`, `serve`, `attach`), 19 built-in tools, MCP integration, agent system, session management, permission system, and provider support are fully preserved. Single-user local usage only — no server, no team collaboration, no web UI.

---

## Package Structure

Packages are organized into four directories that map directly to MVC layers. The folder name **is** the layer — easy to navigate.

```
packages/
  shared/                        ← foundation packages, unchanged from original
    schema/      @gco/schema     — entity types, event union, provider IDs
    llm/         @gco/llm        — 4 AI provider adapters: Anthropic, Vertex AI, DeepSeek, Ollama

  model/                         ← data layer: entities, repo interfaces, GCP implementations
    domain/      @gco/model-domain     — entity interfaces + repository contracts (no I/O)
    firestore/   @gco/model-firestore  — Firestore implementations of all repos
    secrets/     @gco/model-secrets    — Secret Manager credential repo
    test/        @gco/model-test       — in-memory implementations of every repo interface (no GCP needed)

  controller/                    ← orchestration: business logic, no UI code
    cli/         @gco/controller-cli      — all 18 CLI command controllers
    session/     @gco/controller-session  — LLM turn orchestration, streaming
    agent/       @gco/controller-agent    — agent lifecycle, routing
    mcp/         @gco/controller-mcp      — MCP client management + OAuth
    tool/        @gco/controller-tool     — tool registry, execution, permissions

  view/                          ← terminal output only: TUI and CLI formatters
    tui/         @gco/view-tui   — SolidJS + OpenTUI terminal UI (near-verbatim copy)
    cli/         @gco/view-cli   — plain-text formatters, table/color utils, yargs entry

  infra-gcp/     @gco/infra-gcp  — all @google-cloud/* SDK wrappers in one place
```

**Dropped packages:** `effect-drizzle-sqlite`, `effect-sqlite-node`, `lotus`, `protocol`, `server` — no client-server networking needed for single-user local usage.  
**Dropped from original:** `view-web` — terminal-only. `plugin` — no extension system. `serve`/`attach` commands — no team server. 20 LLM providers — keeping only Anthropic, Vertex AI, DeepSeek, Ollama.

---

## 1. Model Layer (`packages/model/`)

### Domain Entities (`model/domain/src/entities/`)

Re-exports from `@gco/schema` — no duplication. Adds TypeScript interfaces for repository contracts:

```
Session.ts, Message.ts, Agent.ts, Credential.ts, Permission.ts, Config.ts, Workspace.ts, Project.ts, SessionEvent.ts
```

### Repository Interfaces (`model/domain/src/repositories/`)

```typescript
// ISessionRepository.ts
interface ISessionRepository {
  get(id: Session.ID): Effect.Effect<Session.Info | undefined>
  list(projectID: Project.ID, anchor?: ListAnchor): Effect.Effect<Session.Info[]>
  create(info: Session.Info): Effect.Effect<void>
  update(id: Session.ID, patch: Partial<Session.Info>): Effect.Effect<void>
  archive(id: Session.ID): Effect.Effect<void>
}

// IEventRepository.ts
interface IEventRepository {
  append(aggregateID: string, events: DurableEvent[]): Effect.Effect<void>
  load(aggregateID: string, fromSeq?: number): Effect.Effect<DurableEvent[]>
  loadFromCompaction(aggregateID: string): Effect.Effect<DurableEvent[]>
}

// ICredentialRepository.ts  — identical signature to core/src/credential.ts Credential.Interface
// IPermissionRepository.ts  — saved always/reject decisions
// IProjectRepository.ts, IWorkspaceRepository.ts
```

### Firestore Data Model (`model/firestore/src/`)

Collections:

```
/sessions/{sessionID}
  id, projectID, workspaceID?, parentID?
  title, agent?, model?
  cost, tokens.{input, output, reasoning, cache.{read,write}}
  time.{createdMillis, updatedMillis, archivedMillis?}
  location.{directory, subpath?}
  eventSeq: number          ← monotonic counter (transactionally incremented on append)
  lastCompactionSeq: number

  /events/{ulid()}           ← subcollection; one doc per DurableEvent
    seq: number
    type: string             ← e.g. "session.next.tool.called"
    data: object             ← Effect Schema encoded payload

/projects/{projectID}, /workspaces/{workspaceID}, /permissions/{permissionID}
/credentials/{integrationID}
  secretManagerPath: string  ← "projects/PROJECT/secrets/cred-{id}/versions/latest"
```

**Batch-write strategy:** Each LLM turn's durable events are committed as a single Firestore `WriteBatch`, keeping write operations within the 20K/day free tier.

**Live-only events** (`Text.Delta`, `Reasoning.Delta`, `Compaction.Delta`, `Tool.Input.Delta`) are never written to Firestore — they route via Pub/Sub only.

### Cloud Storage (`infra-gcp/src/storage/GCSStorage.ts`)

Implements `IArtifactStore`:
- `gs://{PROJECT}-exports/sessions/{sessionID}/` — session export files (`export` command)
- `gs://{PROJECT}-artifacts/sessions/{sessionID}/{messageID}/` — image/PDF attachments
- `gs://{PROJECT}-snapshots/sessions/{sessionID}/{messageID}.diff` — snapshot diffs

---

## 2. Controller Layer (`packages/controller/`)

### Session Controller (`controller/session/src/`)

- `SessionController.ts` — create, prompt, interrupt, resume, revert (delegates to repos)
- `SessionRunner.ts` — wraps `core/src/session/runner/llm.ts`; streams events in-process to the TUI
- `SessionExporter.ts` — builds JSON/markdown, uploads to GCS via `IArtifactStore`

### Tool Controller (`controller/tool/src/`)

- `ToolRegistry.ts` — registration + discovery (builtins + MCP tools); same interface as `core/src/tool/registry.ts`
- `ToolPermissionEnforcer.ts` — reads saved rules from Firestore `IPermissionRepository`; interactive prompts surface in TUI terminal dialog
- `tools/` — 19 tool files wrapping originals 1:1:
  ```
  BashTool, ReadTool, WriteTool, EditTool, GlobTool, GrepTool,
  WebFetchTool, WebSearchTool, QuestionTool, ApplyPatchTool,
  TodoWriteTool, SkillTool, HttpBodyTool, ReadFilesystemTool,
  LspTool, McpWebsearchTool, ApplyUnifiedDiffTool, AgentTool, TaskTool
  ```

### MCP Controller (`controller/mcp/src/`)

Moves `packages/opencode/src/mcp/` verbatim. Adds:
- `webhooks/McpWebhook.ts` — Cloud Functions HTTP trigger for `tool-list-changed`; publishes to `mcp-tools-changed` Pub/Sub topic so running sessions pick up new MCP tools without restart

### Agent Controller (`controller/agent/src/`)

- `AgentController.ts` — get, list, defaultAgent, generate (wraps existing `Agent.Service`)
- `AgentRegistry.ts` — loads agent config; reads from Firestore project doc for remote/shared agent definitions

### CLI Controllers (`controller/cli/src/commands/`)

One file per command, pure orchestration (no UI or formatting code):
```
TuiCommand, RunCommand, AgentCommand, McpCommand, ProvidersCommand, ModelsCommand,
SessionCommand, ExportCommand, ImportCommand, DbCommand,
GenerateCommand, UninstallCommand, UpgradeCommand, DebugCommand, PromptDisplayCommand
```

---

## 3. View Layer (`packages/view/`)

Terminal output only — no web, no browser.

### TUI (`view/tui/src/`)

Near-verbatim copy of `packages/tui/src/`. Session events stream in-process — no networking changes needed.

```
app.tsx, keymap.tsx, runtime.tsx
routes/
  home.tsx
  session/{index.tsx, footer.tsx, sidebar.tsx, permission.tsx, question.tsx, dialogs/}
context/   (23 providers: sdk, theme, route, permission, data, sync, runtime, ...)
component/ (37 terminal components)
ui/        (dialog, toast, spinner, border)
theme/
util/
```

### CLI Formatters (`view/cli/src/`)

Pure functions `(data) => string` — no side effects, no GCP imports:

```
formatters/
  session.formatter.ts
  provider.formatter.ts
  model.formatter.ts
  agent.formatter.ts
  mcp.formatter.ts
  credential.formatter.ts
output/
  progress.ts   ← spinner/clack wrappers
  table.ts      ← ASCII table builder
  color.ts      ← ANSI color helpers
```

Controllers call formatters; formatters never call controllers.

---

## 4. Google Cloud Services

### GCP Service Map

| Service | Replaces / Adds | Free Tier | Estimated Usage |
|---|---|---|---|
| **Vertex AI** | Adds Gemini 2.0 Flash + 2.5 Pro as a new terminal provider | $300 credit ≈ 4B tokens | Optional; selected per-session via `--model vertex-ai/gemini-2.0-flash-001` |
| **Cloud Firestore** | SQLite + Drizzle ORM | 1GB, 50K reads/20K writes per day | ~80K event writes/day at 100 sessions × 10 turns; batch-write per turn keeps within limit |
| **Cloud Storage** | Local `~/.opencode/storage/` + share feature | 5GB/month | ~10MB/export; easily within limit |
| **Secret Manager** | SQLite-backed plaintext credential storage | 6 secret versions, 10K ops/month | Read once per session start, cached in-process |
| **Cloud Logging** | Local OTLP file exporter | 50GB/month | ~100MB/month per developer |

### Vertex AI (`infra-gcp/src/vertex/VertexAiProvider.ts`)

```typescript
import { VertexAI } from "@google-cloud/vertexai"

export function vertexModel(modelID: string): LanguageModelV3 {
  const vertex = new VertexAI({ project: GCP_PROJECT_ID, location: "us-central1" })
  const model = vertex.getGenerativeModel({ model: modelID })
  return {
    specificationVersion: "v1",
    provider: "vertex-ai",
    modelId: modelID,
    defaultObjectGenerationMode: "json",
    doStream: ...,  // maps Vertex streaming response → AI SDK stream format
    doGenerate: ...,
  }
}
```

Provider IDs in `shared/schema/src/provider.ts`: `"anthropic"`, `"vertex-ai"`, `"deepseek"`, `"ollama"`. Vertex AI models exposed: `gemini-2.0-flash-001`, `gemini-2.5-pro-preview-06-05`.

### Secret Manager (`model/secrets/src/SecretManagerCredentialRepository.ts`)

- **Create:** `createSecret()` → `addSecretVersion(credentialBytes)` → write resource path to Firestore `/credentials/{id}`
- **Get:** read Firestore doc → `accessSecretVersion("...latest")` → decode payload
- **Delete:** `destroySecretVersion()` all versions → `deleteSecret()` → remove Firestore doc
- Implements `ICredentialRepository` — identical to original `Credential.Interface`, all callers unchanged

---

## 5. GCP Credentials & Config

### Where credentials live

GCP credentials are **never** stored in `opencode.json` or Secret Manager — GCP authenticates itself via **Application Default Credentials (ADC)**, a standard mechanism the GCP SDKs pick up automatically.

**Local development (one-time setup):**
```bash
gcloud auth application-default login
# Saves credentials to ~/.config/gcloud/application_default_credentials.json
# All @google-cloud/* SDKs find this automatically — no code changes needed
```

**CI / Cloud Run (production):**
```bash
# Attach a service account to the Cloud Run instance, or set:
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

### What does go in `opencode.json`

The only GCP-specific value the app needs to know at runtime is the project ID and region. Add a `gcp` block to the existing config schema:

```jsonc
// ~/.opencode/opencode.json  (or project-level opencode.json)
{
  "gcp": {
    "projectId": "my-gcloud-opencode",   // your GCP project ID
    "region": "us-central1"              // Vertex AI + Cloud Run region
  }
}
```

`infra-gcp/src/config.ts` reads this block (via the existing `Config.Service`) and exposes `GCP_PROJECT_ID` and `GCP_REGION` as Effect config values consumed by `FirestoreClient`, `VertexAiProvider`, `GCSStorage`, etc. If the block is absent, those services fail with a clear error on startup.

**Nothing else:** API keys for LLM providers (Anthropic, OpenAI, etc.) continue to go in the existing `providers` config block exactly as the original project does today.

---

## 6. Effect-TS Layer Assembly (MVC Composition)

The controller layer is identical whether running against real GCP or the in-memory test layer. Only the model layer swaps.

### Production (`packages/controller/cli/src/bootstrap.ts`)

```typescript
const gcpLayer = Layer.merge(
  FirestoreClient.layer,
  GCSStorage.layer,
  VertexAiProvider.layer,
  CloudLoggingExporter.layer,
)

const modelLayer = Layer.merge(
  FirestoreSessionRepository.layer,        // implements ISessionRepository
  FirestoreEventRepository.layer,          // implements IEventRepository
  SecretManagerCredentialRepository.layer, // implements ICredentialRepository
  FirestorePermissionRepository.layer,
  FirestoreProjectRepository.layer,
).pipe(Layer.provide(gcpLayer))

const controllerLayer = Layer.merge(
  SessionController.layer,
  AgentController.layer,
  McpController.layer,
  ToolController.layer,
).pipe(Layer.provide(modelLayer))
```

### Test layer (`bun test`)

Swaps every GCP repository for an in-memory equivalent — no credentials, no network, no emulators needed.

```typescript
const testModelLayer = Layer.merge(
  InMemorySessionRepository.layer,     // Map<Session.ID, Session.Info> in process
  InMemoryEventRepository.layer,       // Map<aggregateID, DurableEvent[]> in process
  InMemoryCredentialRepository.layer,
  InMemoryPermissionRepository.layer,
  InMemoryProjectRepository.layer,
)

const testControllerLayer = Layer.merge(
  SessionController.layer,   // ← exact same controllers, untouched
  AgentController.layer,
  McpController.layer,
  ToolController.layer,
).pipe(Layer.provide(testModelLayer))  // ← only this line differs from production
```

**Layer boundary rule (enforced by ESLint `no-restricted-imports` per package):**
- `view/*` — may not import from `model/firestore`, `model/secrets`, or `infra-gcp`
- `controller/*` — may not import from `view/*`
- `model/*` — may not import from `controller/*` or `view/*`
- `model/test/*` — dev dependency only; never imported by production packages

---

## 7. Full Directory Tree

```
gcloud-opencode/
├── package.json              (Bun workspace — lists all packages below)
├── turbo.json
├── tsconfig.json
├── bunfig.toml
├── Dockerfile                (optional — for future containerisation)
├── .gcloudignore
│
└── packages/
    │
    ├── shared/               ← SHARED FOUNDATION
    │   ├── schema/src/
    │   │   ├── session.ts
    │   │   ├── session-event.ts   (28 DurableEvent types → Firestore docs)
    │   │   ├── agent.ts
    │   │   ├── provider.ts        (+ "vertex-ai" added to ProviderV2.ID brand)
    │   │   └── ...
    │   └── llm/src/
    │       ├── providers/
    │       │   ├── anthropic.ts       (@ai-sdk/anthropic)
    │       │   ├── vertex.ts          (via infra-gcp/src/vertex/VertexAiProvider.ts)
    │       │   ├── deepseek.ts        (@ai-sdk/deepseek)
    │       │   └── ollama.ts          (ollama-ai-provider — local models)
    │       └── protocols/
    │
    ├── model/                ← MODEL LAYER
    │   ├── domain/src/
    │   │   ├── entities/
    │   │   │   ├── Session.ts
    │   │   │   ├── Message.ts
    │   │   │   ├── Agent.ts
    │   │   │   ├── Credential.ts
    │   │   │   └── ...
    │   │   └── repositories/
    │   │       ├── ISessionRepository.ts
    │   │       ├── IEventRepository.ts
    │   │       ├── ICredentialRepository.ts
    │   │       ├── IPermissionRepository.ts
    │   │       └── IProjectRepository.ts
    │   ├── firestore/src/
    │   │   ├── FirestoreSessionRepository.ts
    │   │   ├── FirestoreEventRepository.ts
    │   │   ├── FirestorePermissionRepository.ts
    │   │   ├── FirestoreProjectRepository.ts
    │   │   └── FirestoreWorkspaceRepository.ts
    │   ├── secrets/src/
    │   │   └── SecretManagerCredentialRepository.ts
    │   └── test/src/                   ← TEST LAYER (dev only, no GCP)
    │       ├── InMemorySessionRepository.ts
    │       ├── InMemoryEventRepository.ts
    │       ├── InMemoryCredentialRepository.ts
    │       ├── InMemoryPermissionRepository.ts
    │       └── InMemoryProjectRepository.ts
    │
    ├── controller/           ← CONTROLLER LAYER
    │   ├── cli/src/
    │   │   ├── commands/
    │   │   │   ├── TuiCommand.ts
    │   │   │   ├── RunCommand.ts
    │   │   │   ├── AgentCommand.ts
    │   │   │   ├── McpCommand.ts
    │   │   │   ├── ProvidersCommand.ts
    │   │   │   ├── ModelsCommand.ts
    │   │   │   ├── SessionCommand.ts
    │   │   │   ├── ExportCommand.ts
    │   │   │   ├── ImportCommand.ts
    │   │   │   ├── DbCommand.ts
    │   │   │   ├── GenerateCommand.ts
    │   │   │   ├── UninstallCommand.ts
    │   │   │   ├── UpgradeCommand.ts
    │   │   │   ├── DebugCommand.ts
    │   │   │   └── PromptDisplayCommand.ts
    │   │   ├── bootstrap.ts
    │   │   └── yargs-entry.ts
    │   ├── session/src/
    │   │   ├── SessionController.ts
    │   │   ├── SessionRunner.ts
    │   │   ├── SessionExporter.ts
    │   │   ├── SessionImporter.ts
    │   ├── agent/src/
    │   │   ├── AgentController.ts
    │   │   └── AgentRegistry.ts
    │   ├── mcp/src/
    │   │   ├── McpController.ts
    │   │   ├── McpAuthController.ts
    │   │   ├── McpCatalogController.ts
    │   │   └── webhooks/
    │   │       └── McpWebhook.ts   (Cloud Functions handler)
    │   └── tool/src/
    │       ├── ToolController.ts
    │       ├── ToolRegistry.ts
    │       ├── ToolPermissionEnforcer.ts
    │       └── tools/
    │           ├── BashTool.ts
    │           ├── ReadTool.ts
    │           ├── WriteTool.ts
    │           ├── EditTool.ts
    │           ├── GlobTool.ts
    │           ├── GrepTool.ts
    │           ├── WebFetchTool.ts
    │           ├── WebSearchTool.ts
    │           ├── QuestionTool.ts
    │           ├── ApplyPatchTool.ts
    │           ├── TodoWriteTool.ts
    │           ├── SkillTool.ts
    │           ├── HttpBodyTool.ts
    │           ├── ReadFilesystemTool.ts
    │           ├── LspTool.ts
    │           ├── McpWebsearchTool.ts
    │           ├── ApplyUnifiedDiffTool.ts
    │           ├── AgentTool.ts
    │           └── TaskTool.ts
    │
    ├── view/                 ← VIEW LAYER (terminal only)
    │   ├── tui/src/
    │   │   ├── app.tsx
    │   │   ├── keymap.tsx
    │   │   ├── runtime.tsx
    │   │   ├── routes/
    │   │   │   ├── home.tsx
    │   │   │   └── session/
    │   │   │       ├── index.tsx
    │   │   │       ├── footer.tsx
    │   │   │       ├── sidebar.tsx
    │   │   │       ├── permission.tsx
    │   │   │       └── question.tsx
    │   │   ├── context/      (23 SolidJS context providers)
    │   │   ├── component/    (37 terminal components)
    │   │   ├── ui/           (dialog, toast, spinner, border)
    │   │   └── theme/
    │   └── cli/src/
    │       ├── formatters/
    │       │   ├── session.formatter.ts
    │       │   ├── provider.formatter.ts
    │       │   ├── model.formatter.ts
    │       │   ├── agent.formatter.ts
    │       │   ├── mcp.formatter.ts
    │       │   └── credential.formatter.ts
    │       └── output/
    │           ├── progress.ts
    │           ├── table.ts
    │           └── color.ts
    │
    ├── infra-gcp/src/        ← ALL GCP SDK WRAPPERS
    │   ├── firestore/
    │   │   └── FirestoreClient.ts       (singleton Admin SDK init)
    │   ├── storage/
    │   │   └── GCSStorage.ts
    │   ├── secretmanager/
    │   │   └── SecretManagerClient.ts
    │   ├── vertex/
    │   │   └── VertexAiProvider.ts
    │   ├── logging/
    │   │   └── CloudLoggingExporter.ts  (replaces local OTLP exporter)
    │   └── logging/
    │       └── CloudLoggingExporter.ts
```

---

## 8. Migration Strategy (6 Phases)

| Phase | What changes | SQLite still active? |
|---|---|---|
| 1. Restructure | Move packages into `shared/`, `model/`, `controller/`, `view/` folders; create `model/domain` interfaces | Yes |
| 2. Firestore repos | Implement `model/firestore/`; add `OPENCODE_STORAGE_BACKEND=firestore\|sqlite` flag | Yes (default) |
| 3. Secret Manager creds | Implement `model/secrets/`; add `OPENCODE_CREDENTIAL_BACKEND=secretmanager\|sqlite`; one-shot migration script | Yes |
| 4. Cloud Storage | Implement `GCSStorage`; wire into `SessionExporter` | No (Firestore default) |
| 5. Vertex AI | Add `VertexAiProvider`; register `vertex-ai` provider ID; surface in `providers` command | — |

---

## 9. Verification Plan

**MVC boundary enforcement:**
- ESLint `no-restricted-imports` per package — `view/*` cannot import `model/firestore` or `infra-gcp`; checked in CI with `bun run lint`

**Controllers (no GCP needed):**
- `bun test` against `model/test/` in-memory layer; tests run with zero credentials or network

**All CLI commands:**
- Integration tests in `controller/cli/tests/` using in-memory model layer

**All tools:**
- `controller/tool/tests/` runs each tool against a temp directory; permission enforcer uses `InMemoryPermissionRepository`

**MCP integration:**
- Spawn local MCP Inspector server; verify `McpController` discovers tools and routes calls correctly

**Session event sourcing:**
- Pre-recorded event log replayed through `InMemoryEventRepository`; assert `Session.Info` state matches expected; test compaction boundary

**Vertex AI provider:**
- Mock `VertexAI.generateContentStream`; assert AI SDK stream format mapping and token count extraction are correct

**Secret Manager round-trip:**
- Create → Get → Delete; assert value identity using Secret Manager emulator or dedicated test project

**End-to-end:**
- Full recorded fixture: prompt → tool calls → resolution → Firestore session `cost` field updated → session visible in `session list` terminal command

---

## Critical Existing Files to Replicate

| Original File | Why it matters |
|---|---|
| `packages/core/src/session/runner/llm.ts` | LLM turn orchestrator — Vertex AI must be compatible with its stream format |
| `packages/schema/src/session-event.ts` | All 28 `DurableEvent` types — each maps to a Firestore subcollection document |
| `packages/core/src/credential.ts` | `Credential.Interface` — `SecretManagerCredentialRepository` must match this exactly |
| `packages/controller/cli/src/bootstrap.ts` | Effect Layer composition root — where GCP and in-memory layers are wired |
| `packages/core/src/session/store.ts` | All data access methods — `FirestoreSessionRepository` replicates method-for-method |
| `packages/tui/src/app.tsx` | Root TUI context tree — `view/tui` preserves this identically |
| `packages/opencode/src/mcp/index.ts` | MCP client management — moved verbatim into `controller/mcp/` |
