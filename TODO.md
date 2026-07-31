# TODO

Things that still need to be built. Roughly priority order within each section.

---

## Tool implementations

The 19 tool files exist in `controller/tool/src/tools/` but most are stubs — the files are present but the actual logic (shell execution, file I/O, etc.) hasn't been ported from the original `opencode-cli` yet.

- [ ] `BashTool` — shell command execution with timeout, output streaming
- [ ] `ReadTool` — file read with line range support
- [ ] `WriteTool` — atomic file write
- [ ] `EditTool` — exact string replacement with uniqueness check
- [ ] `GlobTool` — file pattern matching
- [ ] `GrepTool` — ripgrep / regex file search
- [ ] `WebFetchTool` — HTTP fetch with content extraction
- [ ] `WebSearchTool` — web search (requires provider key)
- [ ] `QuestionTool` — ask the user a question, block until answered
- [ ] `ApplyPatchTool` — apply a unified diff
- [ ] `ApplyUnifiedDiffTool` — apply a fenced unified diff block
- [ ] `TodoWriteTool` — write structured TODOs
- [ ] `SkillTool` — invoke a named skill
- [ ] `HttpBodyTool` — fetch raw HTTP body
- [ ] `ReadFilesystemTool` — directory listing with stat info
- [ ] `LspTool` — LSP diagnostics / hover / references
- [ ] `McpWebsearchTool` — web search via an MCP server
- [ ] `AgentTool` — spawn a sub-agent
- [ ] `TaskTool` — create / update tasks in-session

---

## CLI command implementations

The command files exist and have yargs wiring, but several are stubs that print nothing or `TODO`.

- [ ] `RunCommand` — `gcloud-opencode run "prompt"` non-interactive single-shot mode; needs to run `SessionRunner` and stream output to stdout
- [ ] `ExportCommand` — wire to `SessionExporter`, stream progress, print resulting `gs://` URI
- [ ] `ImportCommand` — wire to `SessionImporter`
- [ ] `DbCommand` — show Firestore collection counts / recent docs (debug helper)
- [ ] `GenerateCommand` — unclear purpose; clarify or remove
- [ ] `UninstallCommand` — remove config, credentials, local state
- [ ] `UpgradeCommand` — check for newer version, self-update
- [ ] `DebugCommand` — dump runtime config, connection status
- [ ] `PromptDisplayCommand` — render a prompt template for inspection

Commands known to be real: `TuiCommand`, `SessionCommand` (list/delete), `AgentCommand`, `McpCommand`, `ProvidersCommand`, `ModelsCommand`.

---

## TUI wiring

The TUI package (`view/tui`) exists but it needs to be connected to `SessionRunner` so that live events (text deltas, tool progress) stream into the UI in real time.

- [ ] Wire `SessionRunner` event stream to TUI context providers
- [ ] `session.next.text.delta` → render streaming text in message view
- [ ] `session.next.tool.input.delta` → show live tool input
- [ ] `session.next.compaction.started/ended` → show compaction indicator
- [ ] Permission prompt (from `QuestionTool` / `ToolPermissionEnforcer`) → TUI dialog
- [ ] Interrupt (Ctrl-C) → call `SessionController.interrupt()`

---

## Session metadata

- [ ] **Cost tracking** — `cost: 0` is hardcoded in every `step.ended` event. Wire actual token pricing per model to compute and accumulate real cost in the session doc.
- [ ] **Title auto-generation** — after the first assistant turn, fire the `title` agent (from `AgentRegistry`) with the first user message. Write the result back to `SessionRepository.update()`. Currently session titles are all `"New session - {ISO date}"`.
- [ ] **Session summary** — the `summary` agent exists but is never triggered.

---

## Test suite

Zero tests exist. Highest-value tests to write first:

- [ ] `SessionRunner` round-trip — create session, append prompt event, run, assert `step.ended` event written to `InMemoryEventRepository`
- [ ] `projectMessages()` — replay a canned event log, assert correct `SessionMessage[]` output
- [ ] Compaction boundary — append a `compaction.ended` event, assert `loadFromCompaction` returns only events from that seq forward
- [ ] `FirestoreEventRepository` — integration test against Firestore emulator: append → load → loadFromCompaction, assert `lastCompactionSeq` is written
- [ ] `GoogleIdentity` — mock the userinfo endpoint, assert the service returns the correct email
- [ ] Tool permission enforcer — stub `IPermissionRepository` with a pre-saved always-allow rule, assert tool executes without prompt

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

- [ ] `gcloud-opencode session delete` — the command exists but the delete logic in `SessionController` / `ISessionRepository` is not implemented
- [ ] `SessionImporter` — verify import from `gs://` URI fully reconstructs event log
- [ ] `SessionExporter` — verify markdown and JSON export formats match what `session list` shows
- [ ] Structured logging — `CloudLogger` is wired into `cloud` but nothing calls it yet; add log calls at key lifecycle points (session start, LLM turn, tool execution, compaction)
