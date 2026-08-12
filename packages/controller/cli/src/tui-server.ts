/**
 * tui-server.ts — in-process HTTP server for the TUI client.
 *
 * Implements the lotus-code-compatible REST + SSE API that @gco/view-tui
 * connects to. Routes are backed by real Effect services passed in from
 * TuiCommand (which runs them inside a single Effect scope so their
 * lifecycle stays tied to the TUI session).
 */

import type { Server } from "bun"
import { execSync } from "node:child_process"
import * as os from "node:os"
import * as path from "node:path"

// ─── Service interface ────────────────────────────────────────────────────────

export interface TuiServerServices {
  readonly createSession: (input: {
    projectID: string
    title?: string
    agent?: string
    model?: { id: string; providerID: string }
    location: { directory: string }
  }) => Promise<any>
  readonly getSession: (id: string) => Promise<any>
  readonly listSessions: (projectID: string) => Promise<any[]>
  readonly prompt: (input: {
    sessionID: string
    text: string
    files?: any[]
    parts?: any[]
    id?: string
  }) => Promise<void>
  readonly loadEvents: (sessionID: string) => Promise<any[]>
  readonly archiveSession: (sessionID: string) => Promise<void>
  readonly abortSession: (sessionID: string) => Promise<void>
  readonly updateSession: (sessionID: string, patch: { title?: string }) => Promise<any>
  readonly forkSession: (sessionID: string, opts?: { messageID?: string; partID?: string }) => Promise<any>
  readonly revertSession: (sessionID: string, messageID: string) => Promise<void>
  readonly listAgents: () => Promise<any[]>
  readonly listSkills: () => Promise<Array<{ id: string; name: string; description: string; body: string }>>
  readonly listTools: () => Promise<Array<{ name: string; description: string }>>
  readonly listMcpServers: () => Promise<Array<{ id: string; name: string; status: string; error?: string; config: any; tools: string[] }>>
  readonly listProjects: () => Promise<Array<{ id: string; worktree: string; time: { created: number; updated: number } }>>
  readonly addMcp: (name: string, config: { type: "local"; command: string[]; cwd?: string; environment?: Record<string, string>; timeout?: number } | { type: "remote"; url: string; headers?: Record<string, string>; timeout?: number }) => Promise<Record<string, { status: string; error?: string }>>
  readonly connectMcp: (name: string) => Promise<void>
  readonly disconnectMcp: (name: string) => Promise<void>
  readonly listCredentials: () => Promise<Array<{ integrationID: string }>>
  readonly setProviderKey: (providerID: string, key: string) => Promise<void>
  readonly listQuestions: (sessionID: string) => Promise<Array<{ id: string; sessionID: string; questions: readonly any[]; tool: any }>>
  readonly replyQuestion: (requestID: string, answers: ReadonlyArray<ReadonlyArray<string>>) => Promise<void>
  readonly rejectQuestion: (requestID: string) => Promise<void>
}

// In-memory config override (set via PATCH /config)
let configOverride: Record<string, unknown> = {}

// ─── SSE helpers ─────────────────────────────────────────────────────────────

type SSESend = (raw: string) => void
const sseClients = new Set<SSESend>()

function broadcastSSE(globalEvent: object): void {
  const raw = `data: ${JSON.stringify(globalEvent)}\n\n`
  for (const send of sseClients) send(raw)
}

function toGlobalEvent(event: any, directory: string): object {
  return {
    directory,
    payload: {
      id: event.id ?? `evt_${Date.now()}`,
      type: event.type,
      properties: event.data ?? {},
    },
  }
}

// Per-session polling — starts when prompt is submitted, stops after idle.
const activePollers = new Map<string, () => void>()

// In-memory staging area for revert operations (sessionID → { messageID, partID })
const revertStage = new Map<string, { messageID: string; partID?: string }>()

async function startEventPoller(
  sessionID: string,
  directory: string,
  loadEvents: (id: string) => Promise<any[]>,
): Promise<void> {
  if (activePollers.has(sessionID)) return
  let running = true
  activePollers.set(sessionID, () => { running = false })

  let seenCount = 0
  let idleMs = 0
  const IDLE_STOP_MS = 60_000  // stop polling 60 s after last event

  while (running) {
    const events = await loadEvents(sessionID).catch((err) => {
      console.error("[tui-server] loadEvents error:", err)
      return [] as any[]
    })
    const newEvents = events.slice(seenCount)
    seenCount = events.length

    if (newEvents.length > 0) {
      idleMs = 0
      for (const ev of newEvents) {
        broadcastSSE(toGlobalEvent(ev, directory))

        // Emit high-level session.updated so the sidebar refreshes
        if (ev.type === "session.next.step.ended") {
          broadcastSSE({
            directory,
            payload: {
              id: `upd_${Date.now()}`,
              type: "session.updated",
              properties: { sessionID },
            },
          })
        }
      }

      // Check if the turn is done — stop after step.ended / step.failed
      const done = newEvents.some(
        (e) =>
          e.type === "session.next.step.ended" ||
          e.type === "session.next.step.failed",
      )
      if (done) {
        // Wait a bit for any trailing events, then stop
        await new Promise((r) => setTimeout(r, 500))
        const finalEvents = await loadEvents(sessionID).catch(() => [] as any[])
        for (const ev of finalEvents.slice(seenCount)) {
          broadcastSSE(toGlobalEvent(ev, directory))
        }
        running = false
        break
      }
    } else {
      idleMs += 150
      if (idleMs >= IDLE_STOP_MS) {
        running = false
        break
      }
    }

    await new Promise((r) => setTimeout(r, 150))
  }

  activePollers.delete(sessionID)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })

// ─── OpenAPI spec ─────────────────────────────────────────────────────────────

function buildOpenApiSpec(port: number): object {
  return {
    openapi: "3.0.3",
    info: {
      title: "lotus-code API",
      version: "0.1.0",
      description: "In-process HTTP API served by the lotus-code TUI server. Poll `GET /debug/session/{id}/events` to read LLM responses after submitting a prompt.",
    },
    servers: [{ url: `http://localhost:${port}`, description: "Local TUI server" }],
    tags: [
      { name: "Health & Config" },
      { name: "Sessions" },
      { name: "Debug" },
      { name: "Skills" },
      { name: "MCP" },
      { name: "VCS" },
      { name: "Agents & Commands" },
      { name: "Projects" },
    ],
    paths: {
      "/global/health": {
        get: { tags: ["Health & Config"], summary: "Health check", responses: { "200": { description: "OK" } } },
      },
      "/global/event": {
        get: { tags: ["Health & Config"], summary: "SSE event stream", description: "Server-Sent Events stream. Emits session lifecycle events and LLM turn events in real time.", responses: { "200": { description: "SSE stream (text/event-stream)" } } },
      },
      "/config": {
        get: {
          tags: ["Health & Config"], summary: "Get config",
          responses: { "200": { description: "Current config", content: { "application/json": { schema: { type: "object", properties: { model: { type: "string", example: "deepseek/deepseek-chat" } } } } } } },
        },
        patch: {
          tags: ["Health & Config"], summary: "Update config (persists model to lotus-code.json)",
          requestBody: { content: { "application/json": { schema: { type: "object", properties: { model: { type: "string", example: "deepseek/deepseek-chat" } } } } } },
          responses: { "200": { description: "Merged config" } },
        },
      },
      "/provider": {
        get: { tags: ["Health & Config"], summary: "List providers with model catalog and connection status", responses: { "200": { description: "Provider list" } } },
      },
      "/provider/auth": {
        get: { tags: ["Health & Config"], summary: "Provider auth methods", responses: { "200": { description: "Auth info" } } },
      },
      "/path": {
        get: { tags: ["Health & Config"], summary: "Resolved filesystem paths", responses: { "200": { description: "Paths object with home, state, config, worktree, directory" } } },
      },
      "/session": {
        get: {
          tags: ["Sessions"], summary: "List sessions for the current project",
          responses: { "200": { description: "Array of session objects" } },
        },
        post: {
          tags: ["Sessions"], summary: "Create a session",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    agent: { type: "string", example: "build" },
                    model: { type: "object", properties: { id: { type: "string", example: "deepseek-chat" }, providerID: { type: "string", example: "deepseek" } } },
                    directory: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Created session" } },
        },
      },
      "/session/status": {
        get: { tags: ["Sessions"], summary: "Map of sessionID → running|idle", responses: { "200": { description: "Status map" } } },
      },
      "/session/{id}": {
        get: {
          tags: ["Sessions"], summary: "Get a session",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Session object" }, "404": { description: "Not found" } },
        },
      },
      "/session/{id}/prompt": {
        post: {
          tags: ["Sessions"], summary: "Submit a prompt — LLM runs in background",
          description: "Returns immediately with the user message ID. Poll `GET /debug/session/{id}/events` until you see a `session.next.text.ended` event — the reply is in `data.text`.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["text"], properties: { text: { type: "string", example: "What files are in this directory?" }, files: { type: "array", items: { type: "object" } } } } } } },
          responses: { "200": { description: "User message envelope" } },
        },
      },
      "/session/{id}/message": {
        get: {
          tags: ["Sessions"], summary: "Full conversation history projected from Firestore events",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Array of message objects with role and parts" } },
        },
      },
      "/session/{id}/diff": {
        get: {
          tags: ["Sessions"], summary: "git status for the session working directory",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Array of changed file objects" } },
        },
      },
      "/session/{id}/todo": {
        get: {
          tags: ["Sessions"], summary: "Todo items (not yet wired — returns [])",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Empty array" } },
        },
      },
      "/session/{id}/abort": {
        post: {
          tags: ["Sessions"], summary: "Interrupt the running LLM turn",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK" } },
        },
      },
      "/debug/session/{id}/events": {
        get: {
          tags: ["Debug"], summary: "Raw Firestore events for a session",
          description: "Returns all persisted events in sequence order. Use `data.text` on `session.next.text.ended` events to read LLM replies.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "{ sessionID, count, events[] }" } },
        },
      },
      "/debug/session/abort-all": {
        post: { tags: ["Debug"], summary: "Abort all active sessions", responses: { "200": { description: "{ aborted: number }" } } },
      },
      "/skill": {
        get: {
          tags: ["Skills"], summary: "List skills defined as .md files in the skills/ directory",
          responses: { "200": { description: "Array of { name, description, body }" } },
        },
        post: {
          tags: ["Skills"], summary: "Create a new skill — writes skills/<name>.md",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "body"],
                  properties: {
                    name: { type: "string", example: "reviewer" },
                    body: { type: "string", example: "You are a senior code reviewer..." },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created skill" }, "400": { description: "Validation error" } },
        },
      },
      "/skill/{id}": {
        get: {
          tags: ["Skills"], summary: "Get a single skill by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "{ id, name, description, body }" }, "404": { description: "Not found" } },
        },
        delete: {
          tags: ["Skills"], summary: "Delete skills/<id>.md",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "{ id, removed: true }" } },
        },
      },
      "/tool": {
        get: { tags: ["Skills"], summary: "List registered tools from ToolRegistry", responses: { "200": { description: "Array of { name, description }" } } },
      },
      "/mcp": {
        get: { tags: ["MCP"], summary: "List MCP servers with status, config, and tools", responses: { "200": { description: "{ servers[], connected: number }" } } },
        post: {
          tags: ["MCP"], summary: "Add and connect a new MCP server — persists to lotus-code.json",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    {
                      title: "Local stdio",
                      type: "object",
                      required: ["name", "type", "command"],
                      properties: {
                        name: { type: "string", example: "filesystem" },
                        type: { type: "string", enum: ["local"] },
                        command: { type: "array", items: { type: "string" }, example: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
                        cwd: { type: "string" },
                        environment: { type: "object", additionalProperties: { type: "string" } },
                        timeout: { type: "integer" },
                      },
                    },
                    {
                      title: "Remote SSE",
                      type: "object",
                      required: ["name", "type", "url"],
                      properties: {
                        name: { type: "string", example: "my-api" },
                        type: { type: "string", enum: ["remote"] },
                        url: { type: "string", example: "https://example.com/mcp" },
                        headers: { type: "object", additionalProperties: { type: "string" } },
                        timeout: { type: "integer" },
                      },
                    },
                  ],
                },
              },
            },
          },
          responses: { "200": { description: "Server status after connection attempt" }, "400": { description: "Validation error" } },
        },
      },
      "/mcp/{name}/connect": {
        post: {
          tags: ["MCP"], summary: "Connect a pre-configured MCP server",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "{ name, status: 'connecting' }" } },
        },
      },
      "/mcp/{id}": {
        get: {
          tags: ["MCP"], summary: "Get a single MCP server by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Server object with status, config, and tools" }, "404": { description: "Not found" } },
        },
        delete: {
          tags: ["MCP"], summary: "Disconnect and remove an MCP server from lotus-code.json",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "{ name, removed: true }" } },
        },
      },
      "/vcs": {
        get: { tags: ["VCS"], summary: "Git repo info { type, root, branch, commit }", responses: { "200": { description: "Git info or null" } } },
      },
      "/vcs/status": {
        get: { tags: ["VCS"], summary: "Parsed git status --porcelain", responses: { "200": { description: "Array of { file, staged, unstaged, untracked, status }" } } },
      },
      "/vcs/diff": {
        get: {
          tags: ["VCS"], summary: "Raw git diff",
          parameters: [{ name: "staged", in: "query", schema: { type: "boolean" }, description: "true for staged diff" }],
          responses: { "200": { description: "{ diff: string }" } },
        },
      },
      "/agent": {
        get: { tags: ["Agents & Commands"], summary: "List configured agents", responses: { "200": { description: "Array of agent objects" } } },
      },
      "/command": {
        get: { tags: ["Agents & Commands"], summary: "List available CLI commands with descriptions", responses: { "200": { description: "Array of { name, description }" } } },
      },
      "/lsp": {
        get: { tags: ["Agents & Commands"], summary: "LSP status (not wired — returns { running: false })", responses: { "200": { description: "LSP state" } } },
      },
      "/formatter": {
        get: { tags: ["Agents & Commands"], summary: "Formatter status (not wired — returns { running: false })", responses: { "200": { description: "Formatter state" } } },
      },
      "/project": {
        get: { tags: ["Projects"], summary: "List projects from Firestore", responses: { "200": { description: "Array of project objects" } } },
      },
      "/project/current": {
        get: { tags: ["Projects"], summary: "Current working directory as a project", responses: { "200": { description: "Project object" } } },
      },
      "/project/{id}/directories": {
        get: {
          tags: ["Projects"], summary: "Directories for a project",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Array of { directory }" } },
        },
      },
      "/permission": {
        get: { tags: ["Agents & Commands"], summary: "Pending tool permission requests", responses: { "200": { description: "Array of requests" } } },
      },
      "/question": {
        get: { tags: ["Agents & Commands"], summary: "Pending question requests", responses: { "200": { description: "Array of questions" } } },
      },
    },
  }
}

const SWAGGER_HTML = (specUrl: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>lotus-code API</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>body { margin: 0; } .swagger-ui .topbar { background: #1a1a2e; } .swagger-ui .topbar-wrapper img { content: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'); } .swagger-ui .topbar-wrapper .link::after { content: 'lotus-code API'; color: white; font-weight: bold; font-size: 1.2em; margin-left: 8px; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '${specUrl}',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      plugins: [SwaggerUIBundle.plugins.DownloadUrl],
      layout: 'BaseLayout',
      tryItOutEnabled: true,
      requestInterceptor: (req) => { req.credentials = 'include'; return req; },
    })
  </script>
</body>
</html>`

function sessionToSDK(info: any): object {
  const toMs = (dt: unknown): number => {
    if (typeof dt === "number") return dt
    if (dt && typeof (dt as any).epochMillis === "number") return (dt as any).epochMillis
    if (dt instanceof Date) return dt.getTime()
    return Date.now()
  }
  return {
    id: String(info.id),
    slug: String(info.id),
    projectID: String(info.projectID),
    directory: info.location?.directory ?? "",
    title: info.title ?? "Untitled",
    version: "0.1.0",
    cost: info.cost ?? 0,
    tokens: info.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    model: info.model
      ? { id: info.model.id, providerID: (info.model as any).providerID ?? "deepseek" }
      : { id: "deepseek-chat", providerID: "deepseek" },
    time: {
      created: toMs(info.time?.created),
      updated: toMs(info.time?.updated),
    },
  }
}

function deepseekProvider(): object {
  const connected = Boolean(process.env.DEEPSEEK_API_KEY)
  return {
    id: "deepseek",
    name: "DeepSeek",
    source: "config",
    env: ["DEEPSEEK_API_KEY"],
    key: connected ? "***" : undefined,
    options: {},
    models: {
      "deepseek-chat": {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        release: "2025",
        context: 65536,
        limit: { context: 65536, output: 8192 },
      },
      "deepseek-coder": {
        id: "deepseek-coder",
        name: "DeepSeek Coder",
        release: "2025",
        context: 65536,
        limit: { context: 65536, output: 8192 },
      },
      "deepseek-reasoner": {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner (R1)",
        release: "2025",
        context: 65536,
        limit: { context: 65536, output: 8192 },
      },
    },
  }
}

function anthropicProvider(): object {
  const connected = Boolean(process.env.ANTHROPIC_API_KEY)
  return {
    id: "anthropic",
    name: "Anthropic",
    source: "config",
    env: ["ANTHROPIC_API_KEY"],
    key: connected ? "***" : undefined,
    options: {},
    models: {
      "claude-opus-4":     { id: "claude-opus-4",     name: "Claude Opus 4",     release: "2025", context: 200000, limit: { context: 200000, output: 32000 } },
      "claude-sonnet-4":   { id: "claude-sonnet-4",   name: "Claude Sonnet 4",   release: "2025", context: 200000, limit: { context: 200000, output: 16000 } },
      "claude-haiku-4":    { id: "claude-haiku-4",    name: "Claude Haiku 4",    release: "2025", context: 200000, limit: { context: 200000, output: 8000  } },
      "claude-3-5-sonnet": { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", release: "2024", context: 200000, limit: { context: 200000, output: 8192  } },
    },
  }
}

function ollamaProvider(): object {
  return {
    id: "ollama",
    name: "Ollama",
    source: "local",
    env: [],
    options: {},
    models: {},
  }
}

function providerListResponse(connectedIntegrations: string[] = []): object {
  const ds = deepseekProvider() as any
  const ap = anthropicProvider() as any
  const ol = ollamaProvider() as any
  const all = [ds, ap, ol]
  const connected = all
    .filter((p) => {
      if (p.id === "deepseek")  return Boolean(process.env.DEEPSEEK_API_KEY)  || connectedIntegrations.includes("deepseek")
      if (p.id === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY) || connectedIntegrations.includes("anthropic")
      if (p.id === "ollama")    return true
      return false
    })
    .map((p) => p.id)
  return {
    all,
    providers: all,
    default: { deepseek: "deepseek-chat", anthropic: "claude-sonnet-4" },
    connected,
  }
}

// ─── Event → message projection ───────────────────────────────────────────────

function projectEventsToMessages(events: any[], sessionID: string): object[] {
  const messages: object[] = []
  let currentAssistant: any = null
  const toMs = (dt: unknown): number => {
    if (typeof dt === "number") return dt
    if (dt && typeof (dt as any).epochMillis === "number") return (dt as any).epochMillis
    if (typeof dt === "string") return new Date(dt).getTime()
    return Date.now()
  }
  for (const event of events) {
    const data = event.data ?? {}
    switch (event.type) {
      case "session.next.prompt.admitted":
      case "session.next.prompted": {
        if (currentAssistant) { messages.push(currentAssistant); currentAssistant = null }
        messages.push({
          id: data.messageID ?? `msg_${Date.now()}`,
          sessionID,
          role: "user",
          time: { created: toMs(data.timestamp), updated: toMs(data.timestamp) },
          parts: [{ id: `part_${Date.now()}`, type: "text", text: data.prompt?.text ?? "" }],
        })
        break
      }
      case "session.next.step.started": {
        if (currentAssistant) { messages.push(currentAssistant) }
        currentAssistant = {
          id: data.assistantMessageID ?? `msg_${Date.now()}`,
          sessionID,
          role: "assistant",
          time: { created: toMs(data.timestamp), updated: toMs(data.timestamp) },
          parts: [],
        }
        break
      }
      case "session.next.text.ended": {
        if (currentAssistant && data.text) {
          currentAssistant.parts.push({ id: data.textID ?? `part_${Date.now()}`, type: "text", text: data.text })
        }
        break
      }
      case "session.next.tool.called": {
        if (currentAssistant) {
          currentAssistant.parts.push({
            id: data.callID ?? `tool_${Date.now()}`,
            type: "tool-invocation",
            toolName: data.tool ?? "",
            state: "call",
            args: data.input ?? {},
            result: null,
          })
        }
        break
      }
      case "session.next.tool.success": {
        if (currentAssistant) {
          const part = currentAssistant.parts.find((p: any) => p.id === data.callID)
          if (part) {
            part.state = "result"
            part.result = (data.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
          }
        }
        break
      }
      case "session.next.tool.failed": {
        if (currentAssistant) {
          const part = currentAssistant.parts.find((p: any) => p.id === data.callID)
          if (part) { part.state = "error"; part.result = data.error?.message ?? "Tool failed" }
        }
        break
      }
      case "session.next.step.ended":
      case "session.next.step.failed": {
        if (currentAssistant) {
          if (event.type === "session.next.step.failed") currentAssistant.error = data.error?.message ?? "Step failed"
          currentAssistant.time.updated = toMs(data.timestamp)
          currentAssistant.tokens = data.tokens
          messages.push(currentAssistant)
          currentAssistant = null
        }
        break
      }
    }
  }
  if (currentAssistant) messages.push(currentAssistant)
  return messages
}

// ─── Git helpers ──────────────────────────────────────────────────────────────

function gitExec(cmd: string, cwd: string): string {
  try { return execSync(cmd, { cwd, encoding: "utf8", timeout: 5000 }).trim() } catch { return "" }
}

function gitInfo(cwd: string): object | null {
  try {
    const root = gitExec("git rev-parse --show-toplevel", cwd)
    if (!root) return null
    const branch = gitExec("git branch --show-current", cwd)
    const commit = gitExec("git rev-parse --short HEAD", cwd)
    return { type: "git", root, branch, commit }
  } catch { return null }
}

function gitStatus(cwd: string): object[] {
  const out = gitExec("git status --porcelain=v1", cwd)
  if (!out) return []
  return out.split("\n").filter(Boolean).map((line) => {
    const xy = line.slice(0, 2)
    const file = line.slice(3)
    return {
      file,
      staged: xy[0] !== " " && xy[0] !== "?",
      unstaged: xy[1] !== " ",
      untracked: xy[0] === "?",
      status: xy.trim(),
    }
  })
}

function gitDiff(cwd: string, staged = false): string {
  return gitExec(staged ? "git diff --cached" : "git diff", cwd)
}

// ─── Route handler ───────────────────────────────────────────────────────────

function handleRequest(
  req: Request,
  directory: string,
  services: TuiServerServices,
): Response | Promise<Response> {
  const url = new URL(req.url)
  const pathname = url.pathname
  const method = req.method

  // ── Health ────────────────────────────────────────────────────────────────
  if (pathname === "/global/health") return new Response("OK")

  // ── SSE event stream ──────────────────────────────────────────────────────
  if (pathname === "/global/event" && method === "GET") {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        let closed = false
        const send: SSESend = (raw) => {
          if (!closed) controller.enqueue(encoder.encode(raw))
        }
        sseClients.add(send)

        // Send server.connected immediately
        send(
          `data: ${JSON.stringify({
            directory,
            payload: { id: `conn_${Date.now()}`, type: "server.connected", properties: {} },
          })}\n\n`,
        )

        const ping = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": ping\n\n"))
        }, 15_000)

        return () => {
          closed = true
          clearInterval(ping)
          sseClients.delete(send)
        }
      },
    })
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    })
  }

  // ── Config ────────────────────────────────────────────────────────────────
  if ((pathname === "/config" || pathname === "/global/config") && method === "GET")
    return json({ model: "deepseek/deepseek-chat", ...configOverride })

  if ((pathname === "/config" || pathname === "/global/config") && method === "PATCH") {
    return (async () => {
      try {
        const body = await req.json() as Record<string, unknown>
        Object.assign(configOverride, body)
        // Persist model change to lotus-code.json if present
        if (body.model && typeof body.model === "string") {
          try {
            const cfgPath = path.join(directory, "lotus-code.json")
            const file = Bun.file(cfgPath)
            const existing = await file.exists() ? await file.json().catch(() => ({})) : {}
            existing.model = body.model
            await Bun.write(cfgPath, JSON.stringify(existing, null, 2) + "\n")
          } catch { /* non-fatal */ }
        }
      } catch { /* malformed body */ }
      return json({ model: "deepseek/deepseek-chat", ...configOverride })
    })()
  }

  // ── Providers ─────────────────────────────────────────────────────────────
  if (
    (pathname === "/config/providers" || pathname === "/provider") &&
    method === "GET"
  ) {
    return (async () => {
      const creds = await services.listCredentials().catch(() => [] as any[])
      return json(providerListResponse(creds.map((c: any) => c.integrationID)))
    })()
  }

  if (pathname === "/provider/auth" && method === "GET") return json({})

  // PATCH /provider/:id — set API key for a provider
  const providerPatchMatch = pathname.match(/^\/provider\/([^/]+)$/)
  if (providerPatchMatch && method === "PATCH") {
    const providerID = decodeURIComponent(providerPatchMatch[1]!)
    return (async () => {
      let body: any = {}
      try { body = await req.json() } catch {}
      const key = body.value?.key ?? body.key
      if (key && typeof key === "string") {
        await services.setProviderKey(providerID, key).catch(() => {})
      }
      const creds = await services.listCredentials().catch(() => [] as any[])
      return json(providerListResponse(creds.map((c: any) => c.integrationID)))
    })()
  }

  // ── Agents ────────────────────────────────────────────────────────────────
  if (pathname === "/agent" && method === "GET") {
    return (async () => {
      const agents = await services.listAgents().catch(() => [])
      const sdkAgents = agents
        .filter((a) => !a.hidden)
        .map((a) => ({
          name: a.name ?? a.id,
          description: a.description,
          mode: a.mode ?? "primary",
          native: true,
          hidden: false,
          permission: {},
          options: {},
        }))
      return json(sdkAgents)
    })()
  }

  // ── Skills (markdown files in skills/) ───────────────────────────────────
  if (pathname === "/skill" && method === "GET") {
    return (async () => {
      const skills = await services.listSkills().catch(() => [] as any[])
      return json(skills)
    })()
  }

  // ── Tools (registered ToolRegistry entries) ───────────────────────────────
  if (pathname === "/tool" && method === "GET") {
    return (async () => {
      const tools = await services.listTools().catch(() => [] as any[])
      return json(tools.map((t) => ({ name: t.name, description: t.description })))
    })()
  }

  // ── Sessions — list ───────────────────────────────────────────────────────
  if (pathname === "/session" && method === "GET") {
    return (async () => {
      const projectID = encodeURIComponent(directory)
      const sessions = await services.listSessions(projectID).catch((err) => {
        console.error("[tui-server] listSessions error:", err)
        return [] as any[]
      })
      return json(sessions.map(sessionToSDK))
    })()
  }

  // ── Sessions — status ─────────────────────────────────────────────────────
  if (pathname === "/session/status" && method === "GET") {
    return (async () => {
      const projectID = encodeURIComponent(directory)
      const sessions = await services.listSessions(projectID).catch(() => [] as any[])
      const status: Record<string, string> = {}
      for (const s of sessions) {
        const events = await services.loadEvents(s.id).catch(() => [] as any[])
        const last = events.at(-1)?.type ?? ""
        status[s.id] = (last === "session.next.step.started" || last === "session.next.text.started")
          ? "running" : "idle"
      }
      return json(status)
    })()
  }

  // ── Sessions — create ─────────────────────────────────────────────────────
  if (pathname === "/session" && method === "POST") {
    return (async () => {
      let body: any = {}
      try {
        body = await req.json()
      } catch {}
      const projectID = encodeURIComponent(directory)
      const session = await services.createSession({
        projectID,
        title: body.title,
        agent: body.agent,
        model: body.model ?? { id: "deepseek-chat", providerID: "deepseek", variant: undefined },
        location: { directory: body.directory ?? directory },
      })
      const sdkSession = sessionToSDK(session)

      // Broadcast session.created
      broadcastSSE({
        directory,
        payload: {
          id: `sc_${Date.now()}`,
          type: "session.created",
          properties: { sessionID: (sdkSession as any).id, info: sdkSession },
        },
      })

      return json(sdkSession)
    })()
  }

  // ── Sessions — get ────────────────────────────────────────────────────────
  const sessionMatch = pathname.match(/^\/session\/([^/]+)$/)
  if (sessionMatch && method === "GET") {
    const sessionID = sessionMatch[1]!
    return (async () => {
      const session = await services.getSession(sessionID).catch(() => null)
      if (!session) return json({ error: "Not found" }, 404)
      return json(sessionToSDK(session))
    })()
  }

  // ── Sessions — prompt ─────────────────────────────────────────────────────
  const promptMatch = pathname.match(/^\/session\/([^/]+)\/prompt$/)
  if (promptMatch && method === "POST") {
    const sessionID = promptMatch[1]!
    return (async () => {
      let body: any = {}
      try {
        body = await req.json()
      } catch {}
      const text = body.text ?? body.parts?.[0]?.text ?? ""

      // Fire-and-forget — the runner runs in background
      services
        .prompt({ sessionID, text, files: body.files ?? [], parts: body.parts ?? [] })
        .then(() => console.log(`[tui-server] prompt admitted for ${sessionID}`))
        .catch((err) => console.error("[tui-server] prompt error:", err))

      // Start polling for events produced by this session
      startEventPoller(sessionID, directory, services.loadEvents).catch(
        (err) => console.error("[tui-server] poller error:", err),
      )
      console.log(`[tui-server] poller started for ${sessionID}`)

      const msgID = `msg_${Date.now()}`
      return json({
        id: msgID,
        sessionID,
        role: "user",
        time: { created: Date.now(), updated: Date.now() },
        parts: [{ id: `part_${Date.now()}`, type: "text", text }],
      })
    })()
  }

  // ── Sessions — messages ───────────────────────────────────────────────────
  const msgMatch = pathname.match(/^\/session\/([^/]+)\/message$/)
  if (msgMatch && method === "GET") {
    const sessionID = msgMatch[1]!
    return (async () => {
      const events = await services.loadEvents(sessionID).catch(() => [] as any[])
      return json(projectEventsToMessages(events, sessionID))
    })()
  }

  // ── Sessions — parts ──────────────────────────────────────────────────────
  const partMatch = pathname.match(/^\/session\/([^/]+)\/message\/([^/]+)\/part$/)
  if (partMatch && method === "GET") return json([])

  // ── Debug — raw events for a session ─────────────────────────────────────
  const debugEventsMatch = pathname.match(/^\/debug\/session\/([^/]+)\/events$/)
  if (debugEventsMatch && method === "GET") {
    const sessionID = debugEventsMatch[1]!
    return (async () => {
      const events = await services.loadEvents(sessionID).catch((err) => {
        console.error("[tui-server] debug loadEvents error:", err)
        return []
      })
      return json({ sessionID, count: events.length, events })
    })()
  }

  // ── Debug — abort all sessions ────────────────────────────────────────────
  if (pathname === "/debug/session/abort-all" && method === "POST") {
    return (async () => {
      const projectID = encodeURIComponent(directory)
      const sessions = await services.listSessions(projectID).catch(() => [] as any[])
      await Promise.allSettled(sessions.map((s: any) => services.archiveSession(s.id)))
      for (const stop of activePollers.values()) stop()
      activePollers.clear()
      return json({ aborted: sessions.length })
    })()
  }

  // ── Sessions — PATCH (update title) ──────────────────────────────────────
  if (sessionMatch && method === "PATCH") {
    const sessionID = sessionMatch[1]!
    return (async () => {
      let body: any = {}
      try { body = await req.json() } catch {}
      const updated = await services.updateSession(sessionID, { title: body.title }).catch(() => null)
      if (!updated) return json({ error: "Not found" }, 404)
      const sdkSession = sessionToSDK(updated)
      broadcastSSE({
        directory,
        payload: {
          id: `upd_${Date.now()}`,
          type: "session.updated",
          properties: { sessionID, info: sdkSession },
        },
      })
      return json(sdkSession)
    })()
  }

  // ── Sessions — DELETE ─────────────────────────────────────────────────────
  if (sessionMatch && method === "DELETE") {
    const sessionID = sessionMatch[1]!
    return (async () => {
      await services.archiveSession(sessionID).catch(() => {})
      broadcastSSE({
        directory,
        payload: {
          id: `del_${Date.now()}`,
          type: "session.deleted",
          properties: { sessionID },
        },
      })
      return json({ id: sessionID, deleted: true })
    })()
  }

  // ── Sessions — fork ───────────────────────────────────────────────────────
  const forkMatch = pathname.match(/^\/session\/([^/]+)\/fork$/)
  if (forkMatch && method === "POST") {
    const sessionID = forkMatch[1]!
    return (async () => {
      const forked = await services.forkSession(sessionID).catch(() => null)
      if (!forked) return json({ error: "Failed to fork session" }, 500)
      const sdkSession = sessionToSDK(forked)
      broadcastSSE({
        directory,
        payload: {
          id: `fork_${Date.now()}`,
          type: "session.created",
          properties: { sessionID: (sdkSession as any).id, info: sdkSession },
        },
      })
      return json(sdkSession)
    })()
  }

  // ── Sessions — revert/stage ───────────────────────────────────────────────
  const revertStageMatch = pathname.match(/^\/session\/([^/]+)\/revert\/stage$/)
  if (revertStageMatch && method === "POST") {
    const sessionID = revertStageMatch[1]!
    return (async () => {
      let body: any = {}
      try { body = await req.json() } catch {}
      const messageID = body.messageID
      if (!messageID) return json({ error: "messageID is required" }, 400)
      revertStage.set(sessionID, { messageID, partID: body.partID })
      return json({ sessionID, messageID, staged: true })
    })()
  }

  // ── Sessions — revert/commit ──────────────────────────────────────────────
  const revertCommitMatch = pathname.match(/^\/session\/([^/]+)\/revert\/commit$/)
  if (revertCommitMatch && method === "POST") {
    const sessionID = revertCommitMatch[1]!
    return (async () => {
      const staged = revertStage.get(sessionID)
      if (!staged) return json({ error: "No revert staged for this session" }, 400)
      revertStage.delete(sessionID)
      await services.revertSession(sessionID, staged.messageID).catch((e) => {
        console.error("[tui-server] revert error:", e)
        throw e
      })
      broadcastSSE({
        directory,
        payload: {
          id: `rev_${Date.now()}`,
          type: "session.updated",
          properties: { sessionID },
        },
      })
      return json({ sessionID, reverted: true })
    })()
  }

  // ── Sessions — revert/clear ───────────────────────────────────────────────
  const revertClearMatch = pathname.match(/^\/session\/([^/]+)\/revert\/clear$/)
  if (revertClearMatch && method === "POST") {
    const sessionID = revertClearMatch[1]!
    revertStage.delete(sessionID)
    return json({ sessionID, cleared: true })
  }

  // ── Sessions — unrevert ───────────────────────────────────────────────────
  const unrevertMatch = pathname.match(/^\/session\/([^/]+)\/unrevert$/)
  if (unrevertMatch && method === "POST") return json({})

  // ── Sessions — diff / todo / abort ───────────────────────────────────────
  if (pathname.startsWith("/session/") && pathname.includes("/diff") && method === "GET") {
    const sid = pathname.split("/")[2]!
    return (async () => {
      const session = await services.getSession(sid).catch(() => null)
      const dir = (session as any)?.location?.directory ?? directory
      return json(gitStatus(dir))
    })()
  }
  if (pathname.startsWith("/session/") && pathname.includes("/todo") && method === "GET") return json([])
  if (pathname.startsWith("/session/") && pathname.includes("/abort") && method === "POST") {
    const sid = pathname.split("/")[2]!
    return (async () => {
      await services.abortSession(sid).catch(() => {})
      return json({})
    })()
  }

  // ── Permissions / Questions ───────────────────────────────────────────────
  if (pathname === "/permission" && method === "GET") return json([])
  if (pathname === "/question" && method === "GET") return json([])

  // ── Commands — sourced from yargs command definitions ─────────────────────
  if (pathname === "/command" && method === "GET") {
    return json([
      { name: "run [message..]",          description: "Run lotus-code with a message (non-interactive)" },
      { name: "session list",             description: "List sessions" },
      { name: "session delete",           description: "Delete a session" },
      { name: "export [sessionID]",       description: "Export session data to GCS" },
      { name: "import <source>",          description: "Import session data from a local file or gs:// URI" },
      { name: "agent list",               description: "List all available agents" },
      { name: "mcp list",                 description: "List MCP servers and their status" },
      { name: "mcp add",                  description: "Add an MCP server" },
      { name: "mcp auth",                 description: "Authenticate with an MCP server" },
      { name: "providers list",           description: "List providers and credentials" },
      { name: "models [provider]",        description: "List all available models" },
      { name: "db path",                  description: "Print Firestore project and collection information" },
      { name: "upgrade [target]",         description: "Upgrade lotus-code to the latest or a specific version" },
      { name: "uninstall",                description: "Uninstall lotus-code and remove all related files" },
    ])
  }

  // ── LSP / Formatter — not wired up; return accurate empty state ───────────
  if (pathname === "/lsp" && method === "GET") return json({ running: false, servers: [] })
  if (pathname === "/formatter" && method === "GET") return json({ running: false, formatters: [] })

  // ── MCP — live status from McpController ─────────────────────────────────
  if (pathname === "/mcp" && method === "GET") {
    return (async () => {
      const servers = await services.listMcpServers().catch(() => [])
      const connected = servers.filter((s) => s.status === "connected").length
      return json({ servers, connected })
    })()
  }

  // GET /mcp/:id — get single server by id
  const mcpIdMatch = pathname.match(/^\/mcp\/([^/]+)$/)
  if (mcpIdMatch && method === "GET") {
    const id = decodeURIComponent(mcpIdMatch[1]!)
    return (async () => {
      const servers = await services.listMcpServers().catch(() => [])
      const server = servers.find((s) => s.id === id)
      if (!server) return json({ error: "Not found" }, 404)
      return json(server)
    })()
  }

  // POST /mcp — add a new MCP server (persists to lotus-code.json + connects immediately)
  // Body: { name: string, type: "local", command: string[], cwd?: string }
  //    or { name: string, type: "remote", url: string, headers?: Record<string,string> }
  if (pathname === "/mcp" && method === "POST") {
    return (async () => {
      let body: any = {}
      try { body = await req.json() } catch { return json({ error: "Invalid JSON" }, 400) }
      const { name, ...config } = body
      if (!name || typeof name !== "string") return json({ error: "name is required" }, 400)
      if (!config.type || (config.type !== "local" && config.type !== "remote"))
        return json({ error: "type must be 'local' or 'remote'" }, 400)
      if (config.type === "local" && (!Array.isArray(config.command) || config.command.length === 0))
        return json({ error: "command[] is required for local servers" }, 400)
      if (config.type === "remote" && !config.url)
        return json({ error: "url is required for remote servers" }, 400)

      // Persist to lotus-code.json
      try {
        const cfgPath = path.join(directory, "lotus-code.json")
        const file = Bun.file(cfgPath)
        const existing = await file.exists() ? await file.json().catch(() => ({})) : {}
        existing.mcp = existing.mcp ?? {}
        existing.mcp[name] = config
        await Bun.write(cfgPath, JSON.stringify(existing, null, 2) + "\n")
      } catch { /* non-fatal — still add at runtime */ }

      const status = await services.addMcp(name, config).catch((e) => ({ error: String(e) }))
      return json({ name, ...status })
    })()
  }

  // POST /mcp/:name/connect — connect an already-configured server
  const mcpConnectMatch = pathname.match(/^\/mcp\/([^/]+)\/connect$/)
  if (mcpConnectMatch && method === "POST") {
    const name = decodeURIComponent(mcpConnectMatch[1]!)
    return (async () => {
      await services.connectMcp(name).catch((e) => { throw e })
      return json({ name, status: "connecting" })
    })()
  }

  // DELETE /mcp/:name — disconnect and remove from lotus-code.json
  const mcpDeleteMatch = pathname.match(/^\/mcp\/([^/]+)$/)
  if (mcpDeleteMatch && method === "DELETE") {
    const name = decodeURIComponent(mcpDeleteMatch[1]!)
    return (async () => {
      await services.disconnectMcp(name).catch(() => {})
      try {
        const cfgPath = path.join(directory, "lotus-code.json")
        const file = Bun.file(cfgPath)
        if (await file.exists()) {
          const existing = await file.json().catch(() => ({}))
          if (existing.mcp) { delete existing.mcp[name]; await Bun.write(cfgPath, JSON.stringify(existing, null, 2) + "\n") }
        }
      } catch { /* non-fatal */ }
      return json({ name, removed: true })
    })()
  }

  // POST /skill — create skills/<name>.md
  if (pathname === "/skill" && method === "POST") {
    return (async () => {
      let body: any = {}
      try { body = await req.json() } catch { return json({ error: "Invalid JSON" }, 400) }
      const { name, body: skillBody } = body
      if (!name || typeof name !== "string") return json({ error: "name is required" }, 400)
      if (!skillBody || typeof skillBody !== "string") return json({ error: "body is required" }, 400)
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) return json({ error: "name may only contain letters, numbers, hyphens and underscores" }, 400)
      try {
        const skillsDir = path.join(directory, "skills")
        await Bun.write(path.join(skillsDir, `${name}.md`), skillBody)
      } catch (e) { return json({ error: `Failed to save: ${e}` }, 500) }
      const description = skillBody.split("\n").find((l: string) => l.trim()) ?? ""
      return json({ id: name, name, description, body: skillBody }, 201)
    })()
  }

  // GET /skill/:id  |  DELETE /skill/:id
  const skillIdMatch = pathname.match(/^\/skill\/([^/]+)$/)
  if (skillIdMatch) {
    const id = decodeURIComponent(skillIdMatch[1]!)
    if (method === "GET") {
      return (async () => {
        const skillPath = path.join(directory, "skills", `${id}.md`)
        const file = Bun.file(skillPath)
        if (!await file.exists()) return json({ error: "Not found" }, 404)
        const body = await file.text()
        const description = body.split("\n").find((l: string) => l.trim()) ?? ""
        return json({ id, name: id, description, body })
      })()
    }
    if (method === "DELETE") {
      return (async () => {
        try {
          const skillPath = path.join(directory, "skills", `${id}.md`)
          const file = Bun.file(skillPath)
          if (await file.exists()) {
            await import("node:fs/promises").then((fs) => fs.unlink(skillPath))
          }
        } catch (e) { return json({ error: `Failed to remove: ${e}` }, 500) }
        return json({ id, removed: true })
      })()
    }
  }

  // ── VCS ───────────────────────────────────────────────────────────────────
  if (pathname === "/vcs" && method === "GET") return json(gitInfo(directory))
  if (pathname === "/vcs/status" && method === "GET") return json(gitStatus(directory))
  if (pathname === "/vcs/diff" && method === "GET") {
    const staged = new URL(req.url).searchParams.get("staged") === "true"
    return json({ diff: gitDiff(directory, staged) })
  }

  // ── Path ──────────────────────────────────────────────────────────────────
  if (pathname === "/path" && method === "GET") {
    const home = os.homedir()
    const state = path.join(home, ".local", "share", "lotus-code")
    return json({
      home,
      state,
      config: path.join(home, ".config", "lotus-code"),
      worktree: path.join(state, "worktree"),
      directory,
    })
  }

  // ── Projects ──────────────────────────────────────────────────────────────
  if (pathname === "/project" && method === "GET") {
    return (async () => {
      const projects = await services.listProjects().catch(() => [] as any[])
      if (projects.length > 0) return json(projects.map((p) => ({ ...p, sandboxes: [] })))
      // Fallback: current directory as the only project
      return json([{
        id: encodeURIComponent(directory),
        worktree: directory,
        time: { created: Date.now(), updated: Date.now() },
        sandboxes: [],
      }])
    })()
  }
  if (pathname === "/project/current" && method === "GET") {
    return json({
      id: encodeURIComponent(directory),
      worktree: directory,
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })
  }
  if (/^\/project\/[^/]+\/directories$/.test(pathname) && method === "GET") {
    return json([{ directory }])
  }

  // ── Dispose ───────────────────────────────────────────────────────────────
  if (pathname === "/global/dispose" && method === "POST") return json({})

  // ── V2 question endpoints ─────────────────────────────────────────────────
  const v2QuestionListMatch = pathname.match(/^\/v2\/session\/([^/]+)\/question$/)
  if (v2QuestionListMatch && method === "GET") {
    const sessionID = decodeURIComponent(v2QuestionListMatch[1]!)
    return (async () => {
      const questions = await services.listQuestions(sessionID).catch(() => [])
      return json({ data: questions })
    })()
  }

  const v2QuestionReplyMatch = pathname.match(/^\/v2\/session\/([^/]+)\/question\/([^/]+)\/reply$/)
  if (v2QuestionReplyMatch && method === "POST") {
    const requestID = decodeURIComponent(v2QuestionReplyMatch[2]!)
    return (async () => {
      let body: any = {}
      try { body = await req.json() } catch {}
      await services.replyQuestion(requestID, body.answers ?? []).catch(() => {})
      return json({})
    })()
  }

  const v2QuestionRejectMatch = pathname.match(/^\/v2\/session\/([^/]+)\/question\/([^/]+)\/reject$/)
  if (v2QuestionRejectMatch && method === "POST") {
    const requestID = decodeURIComponent(v2QuestionRejectMatch[2]!)
    return (async () => {
      await services.rejectQuestion(requestID).catch(() => {})
      return json({})
    })()
  }

  // ── V2 permission endpoints (pending requests — stub empty) ───────────────
  const v2PermissionListMatch = pathname.match(/^\/v2\/session\/([^/]+)\/permission$/)
  if (v2PermissionListMatch && method === "GET") return json({ data: [] })

  // ── Default ───────────────────────────────────────────────────────────────
  return json({ error: `Not implemented: ${method} ${pathname}` }, 404)
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

const DEFAULT_PORT = 60100

export function startTuiServer(directory: string, services: TuiServerServices): Server<undefined> {
  const port = Number(process.env.LOTUS_SERVER_PORT ?? DEFAULT_PORT)
  let serverPort = port
  const server = Bun.serve({
    port,
    idleTimeout: 0,
    fetch(req) {
      try {
        const url = new URL(req.url)
        // ── Swagger UI ──────────────────────────────────────────────────────
        if (url.pathname === "/docs") {
          return new Response(SWAGGER_HTML(`http://localhost:${serverPort}/openapi.json`), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })
        }
        if (url.pathname === "/openapi.json") {
          return json(buildOpenApiSpec(serverPort))
        }
        return handleRequest(req, directory, services) ?? json({}, 204)
      } catch (err) {
        console.error("[tui-server] unhandled error:", err)
        return json({ error: "Internal server error" }, 500)
      }
    },
  })
  serverPort = server.port ?? 0
  process.stderr.write(`[tui-server] listening on http://localhost:${server.port}\n`)
  process.stderr.write(`[tui-server] API docs at http://localhost:${server.port}/docs\n`)
  return server
}
