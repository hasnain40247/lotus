# TODO

Things that still need to be built. Roughly priority order within each section.

---

## 🚨 Blockers

- [ ] **Enable GCP APIs** — Firestore, Secret Manager, Cloud Storage, and Cloud Logging APIs must be enabled in project `gen-lang-client-0983206083` before sessions can be created or stored:
  ```bash
  gcloud services enable \
    firestore.googleapis.com \
    secretmanager.googleapis.com \
    storage.googleapis.com \
    logging.googleapis.com \
    --project gen-lang-client-0983206083
  ```
- [ ] **Create Firestore database** — must be in native mode in `us-central1`:
  ```bash
  gcloud firestore databases create \
    --location=us-central1 \
    --project gen-lang-client-0983206083
  ```

---

## Tool implementations

All 19 tool files in `controller/tool/src/tools/` are fully implemented.

- [x] `BashTool` — shell command execution with timeout, output streaming
- [x] `ReadTool` — file read with line range support
- [x] `WriteTool` — atomic file write
- [x] `EditTool` — exact string replacement with uniqueness check
- [x] `GlobTool` — file pattern matching
- [x] `GrepTool` — ripgrep / regex file search
- [x] `WebFetchTool` — HTTP fetch with content extraction
- [x] `WebSearchTool` — web search (requires provider key)
- [x] `QuestionTool` — ask the user a question, block until answered
- [x] `ApplyPatchTool` — apply a unified diff
- [x] `ApplyUnifiedDiffTool` — apply a fenced unified diff block
- [x] `TodoWriteTool` — write structured TODOs
- [x] `SkillTool` — invoke a named skill
- [x] `HttpBodyTool` — bounded HTTP response body collector (utility, not a user-facing tool)
- [x] `ReadFilesystemTool` — directory listing with stat info
- [x] `LspTool` — LSP diagnostics / hover / references
- [x] `McpWebsearchTool` — web search via an MCP server
- [x] `AgentTool` — spawn a sub-agent
- [x] `TaskTool` — create / update tasks in-session

---

## CLI command implementations

All command files are implemented. One placeholder remains:

- [x] `RunCommand` — `lotus-code run "prompt"` non-interactive single-shot mode
- [x] `ExportCommand` — wired to `SessionExporter`, prints resulting `gs://` URI
- [x] `ImportCommand` — wired to `SessionImporter`
- [x] `DbCommand` — prints Firestore project/collection config (`path` subcommand)
- [x] `GenerateCommand` — generates content via a provider model
- [x] `UninstallCommand` — removes config, credentials, local state
- [x] `UpgradeCommand` — checks for newer version, self-updates
- [x] `DebugCommand` — dumps runtime config, agent registry, paths, env info
- [x] `PromptDisplayCommand` — renders a prompt template for inspection
- [ ] `lotus-code session delete` — `SessionCommand` has the subcommand wired but the handler prints a placeholder; `SessionController` / `ISessionRepository.archive()` exists but is not called

---

## TUI wiring

The TUI package (`view/tui`) exists but it needs to be connected to `SessionRunner` so that live events (text deltas, tool progress) stream into the UI in real time. Currently `tui-server.ts` only surfaces `step.ended` / `step.failed` — not the streaming deltas.

- [ ] Wire `SessionRunner` event stream to TUI context providers
- [ ] `session.next.text.delta` → render streaming text in message view
- [ ] `session.next.tool.input.delta` → show live tool input
- [ ] `session.next.compaction.started/ended` → show compaction indicator
- [ ] Permission prompt (from `QuestionTool` / `ToolPermissionEnforcer`) → TUI dialog
- [ ] Interrupt (Ctrl-C) → call `SessionController.interrupt()`

---

## Session metadata

- [ ] **Cost tracking** — `cost: 0` is hardcoded in `SessionRunner`, `SessionController`, and `SessionImporter`. Wire actual token pricing per model to compute and accumulate real cost in the session doc.
- [ ] **Title auto-generation** — after the first assistant turn, fire the `title` agent (from `AgentRegistry`) with the first user message. Write the result back to `SessionRepository.update()`. Currently session titles are all `"New session - {ISO date}"`.
- [ ] **Session summary** — the `summary` agent exists but is never triggered.

---

## Test suite

Tests exist but several key scenarios from the original list are not yet covered:

- [x] `SessionRunner` round-trip — `session.test.ts` covers create → run → `step.ended`
- [x] Tool permission enforcer — `permission.test.ts` covers allow/deny/wildcard rules
- [ ] `projectMessages()` — no tests replay a canned event log and assert `SessionMessage[]` output
- [ ] Compaction boundary — no test appends a `compaction.ended` event and asserts `loadFromCompaction` returns only events from that seq forward
- [ ] `FirestoreEventRepository` — no integration test against Firestore emulator
- [ ] `GoogleIdentity` — no test mocks the userinfo endpoint

---

## ESLint boundary enforcement

Layer boundary violations (e.g. `view/*` importing `cloud`) are currently not enforced at lint time.

- [ ] Configure `eslint-plugin-import` or `oxlint` `no-restricted-imports` rules per package
- [ ] `view/*` — deny imports from `@gco/model-firestore`, `@gco/model-secrets`, `@gco/cloud`
- [ ] `controller/*` — deny imports from `@gco/view-tui`, `@gco/view-cli`
- [ ] `model/*` — deny imports from `@gco/controller-*`

---

## MCP Cloud Functions webhook

`controller/mcp/src/webhooks/McpWebhook.ts` is planned but not implemented. It's a Cloud Functions HTTP trigger that receives `tool-list-changed` notifications from MCP servers and refreshes the tool registry in running sessions.

- [ ] Implement the Cloud Functions handler
- [ ] Wire Pub/Sub topic + subscription
- [ ] Handle authentication of incoming webhook calls

---

## Provider auth flows

`ProvidersCommand` exists with `login` / `logout` subcommands but the actual auth logic per provider needs verification:

- [ ] Anthropic — API key prompt → Secret Manager create/update
- [ ] DeepSeek — API key prompt → Secret Manager create/update
- [ ] Vertex AI — no separate auth needed (uses ADC), but should show the current GCP project and model availability
- [ ] Ollama — ping localhost, show running models

---

## Firestore security rules

Currently no Firestore security rules are defined. Anyone with the GCP project ID could read/write all user data.

- [ ] Write `firestore.rules` scoping all `/users/{userId}/**` reads/writes to the authenticated Firebase user (or service account)
- [ ] Add rules to CI / deployment

---

## Miscellaneous

- [ ] Structured logging — `CloudLogger` is wired into the GCP layer but no controller calls it yet; add log calls at key lifecycle points (session start, LLM turn, tool execution, compaction)
- [ ] `SessionImporter` — verify import from `gs://` URI fully reconstructs event log
- [ ] `SessionExporter` — verify markdown and JSON export formats match what `session list` shows
- [ ] `DbCommand` collection counts — current `db path` only prints config; add a `db counts` subcommand showing live Firestore document counts per collection
