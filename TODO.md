# TODO

Things that still need to be built. Roughly priority order within each section.

---

## 🚨 Blockers

- [x] **Enable GCP APIs** — Firestore, Secret Manager, Cloud Storage, and Cloud Logging enabled on `gen-lang-client-0983206083`
- [x] **Create Firestore database** — native mode in `us-central1` on `gen-lang-client-0983206083`

---

## Tool implementations

All 19 tool files in `controller/tool/src/tools/` are fully implemented and registered in `builtinToolsLayer` (`bootstrap.ts`).

- [x] `BashTool` (`bash`) — shell command execution with timeout, output streaming
- [x] `ReadTool` (`read`) — file read with line range support
- [x] `WriteTool` (`write`) — atomic file write
- [x] `EditTool` (`edit`) — exact string replacement with uniqueness check
- [x] `GlobTool` (`glob`) — file pattern matching
- [x] `GrepTool` (`grep`) — ripgrep / regex file search
- [x] `WebFetchTool` (`web_fetch`) — HTTP fetch with content extraction
- [x] `WebSearchTool` (`web_search`) — web search (requires provider key)
- [x] `QuestionTool` (`question`) — ask the user a question; registered in TuiCommand at startup with a shared QuestionStore
- [x] `ApplyPatchTool` (`apply_patch`) — apply a unified diff
- [x] `ApplyUnifiedDiffTool` (`apply_unified_diff`) — apply a standard `diff -u` / `git diff` patch
- [x] `TodoWriteTool` (`todowrite`) — write structured TODOs; backed by in-memory store per session
- [x] `SkillTool` (`skill`) — reads `./skills/<name>.md` and returns body; real execution is up to the agent
- [x] `HttpBodyTool` — bounded HTTP response body collector (utility, not registered as a user-facing tool)
- [x] `ReadFilesystemTool` — directory listing helpers (utility module used by ReadTool, not registered separately)
- [x] `LspTool` (`lsp`) — registered; stub reports "no LSP server available" until a real LspService is wired
- [x] `McpWebsearchTool` (`mcp_websearch`) — registered; stub errors until a real McpWebsearchService is wired
- [x] `AgentTool` (`agent`) — real implementation: `spawnSubagent` in `bootstrap.ts` creates a child session inheriting the parent's project/location/model with `agent: subagent_type`, admits the prompt, drives `SessionRunner.run` to completion, and returns the last assistant text. `state: "error"` only when the child produced no usable text
- [x] `TaskTool` (`task`) — same implementation, with `background: true` running the child via `Effect.forkDetach` and returning immediately

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
- [x] `lotus-code session delete` — calls `SessionController.interrupt()` then `SessionRepository.archive()`, prints confirmation

---

## TUI wiring

The core REST endpoints are now wired. Remaining gaps:

- [x] `POST /session/{id}/abort` → `SessionController.interrupt()`
- [x] `DELETE /session/{id}` → archive + broadcasts `session.deleted` SSE
- [x] `PATCH /session/{id}` → `SessionRepository.update()` (title rename)
- [x] `POST /session/{id}/fork` → creates new session from parent params
- [x] `POST /session/{id}/revert/stage` → in-memory staging
- [x] `POST /session/{id}/revert/commit` → `SessionController.revert()`
- [x] `POST /session/{id}/revert/clear` → clears staged revert
- [x] Subagent transcript nesting — parent poller detects `session.next.subagent.spawned` and auto-starts a child event poller so the child's turn events reach the TUI via SSE. TUI routes non-current-session events into a per-`toolCallID` transcript rendered nested under the spawning tool row, collapsed by default
- [x] Agent switcher in TUI — `Tab` cycles primary agents (`build` ↔ `plan`); footer chip + `❯` prompt marker + per-message badge show the active agent with distinct palette colors (build/plan/explore/general); mid-session cycling PATCHes `session.agent` so subsequent turns use the new system prompt + permission ruleset
- [ ] `POST /session/{id}/unrevert` → genuinely not implementable: `revert` destructively truncates the event log with no backup; would need a revert-stack or snapshot mechanism
- [ ] **Streaming deltas** — `session.next.text.delta` and `session.next.tool.input.delta` are live-only in `SessionRunner` (never persisted to Firestore), so the SSE poller never sees them. Need a direct in-process pub/sub channel from `SessionRunner` → `broadcastSSE` to render streaming text and tool input in real time.
- [x] `session.next.compaction.started/ended` → already emitted by `runCompactionImpl` in `SessionRunner` around the summary LLM call
- [x] `QuestionTool` wiring — `QuestionStore` created on TUI startup, registered in tool registry, exposed via `GET /v2/session/{id}/question`, `POST .../reply`, `POST .../reject`
- [x] Permission check — `ToolPermissionEnforcer` is now wired into `SessionRunner`. Before each tool call, saved user rules are checked: `"reject"` immediately settles the tool as a `Permission denied` error; `"ask"` is treated as allow (no interactive channel from the runner). `toolPermissionEnforcerLayer` moved to `infraLayer` so both `SessionRunner` and controllers share the same service instance.
- [ ] Permission prompt — interactive `"ask"` flow not yet implemented. Full fix requires intercepting the `"ask"` decision in the turn loop and suspending until the HTTP layer (or TUI) replies with an allow/deny decision.

---

## Session metadata

- [x] **Cost tracking** — `SessionRunner` now computes per-step USD cost from a pricing table (DeepSeek, Anthropic, Gemini) and accumulates `tokens` + `cost` into the session doc via `SessionRepository.update()` after every step
- [x] **Title auto-generation** — after the run loop completes, a detached fiber calls the LLM with `PROMPT_TITLE` + the first user message and writes the result back via `SessionRepository.update()` if the title is still the default `"New session - …"`
- [ ] **Session summary** — `summary` agent and `PROMPT_SUMMARY` exist but nowhere to store the result: `Session.Info` has no `summary`/`subtitle` field; requires schema change before this can be wired
- [ ] **`SessionImporter` cost** — export format doesn't preserve per-message token counts, so cost stays 0 on import; would need to add token fields to the export schema to fix

---

## Test suite

Tests exist but several key scenarios from the original list are not yet covered:

- [x] `SessionRunner` round-trip — `session.test.ts` covers create → run → `step.ended`
- [x] Tool permission enforcer — `permission.test.ts` covers allow/deny/wildcard rules
- [x] Compaction boundary — `repositories.test.ts` covers `loadFromCompaction` with no boundary, single boundary, and last-boundary-wins cases
- [ ] `projectMessages()` — no tests replay a canned event log and assert `SessionMessage[]` output
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

- [x] DeepSeek — `providers login deepseek` stores API key in `CredentialRepository`; TUI startup loads it into `DEEPSEEK_API_KEY` env var; `ModelResolver` reads from env
- [x] Anthropic — same flow via `ANTHROPIC_API_KEY`; `ModelResolver` routes `claude*` / `anthropic` provider ID to `AnthropicProvider`
- [x] Ollama — `ModelResolver` routes `ollama` provider ID to `OllamaProvider` (no auth needed)
- [x] Vertex AI — uses ADC automatically; `ModelResolver` falls through to `VertexProvider`
- [x] `GET /provider` returns all four providers with live connection status from `CredentialRepository`
- [x] `PATCH /provider/{id}` — TUI can set an API key directly and it takes effect immediately

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
- [ ] Review session runner error handling
- [ ] Add tests for tool call parts
- [ ] Update README with deployment instructions
