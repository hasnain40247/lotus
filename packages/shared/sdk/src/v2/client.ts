// @gco/sdk client — HTTP client that wraps the Neko Code backend API
// Compatible interface with @neko/sdk NekoClient

import type {
  Agent,
  Command,
  Config,
  ExperimentalCapabilities,
  ConsoleState,
  FormatterStatus,
  GlobalEvent,
  LspStatus,
  McpResource,
  McpStatus,
  Message,
  Part,
  PermissionRequest,
  Provider,
  ProviderAuthMethod,
  ProviderListResponse,
  QuestionAnswer,
  QuestionRequest,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
  VcsInfo,
  VcsDiffResponses,
  VcsFileStatus,
  Workspace,
  ProjectDirectories,
  Worktree,
} from "./types"

export type NekoClientConfig = {
  baseUrl?: string
  signal?: AbortSignal
  directory?: string
  experimental_workspaceID?: string
  fetch?: typeof fetch
  headers?: HeadersInit
  sseMaxRetryAttempts?: number
}

type RequestOptions = {
  signal?: AbortSignal
  throwOnError?: boolean
  [key: string]: unknown
}

type ApiResponse<T> = {
  data: T
  error?: unknown
  response: Response
}

// Simple result wrapper matching hey-api shape
function ok<T>(data: T, response: Response): ApiResponse<T> {
  return { data, response }
}

async function request<T>(
  baseUrl: string,
  method: string,
  path: string,
  opts: {
    query?: Record<string, string | number | boolean | undefined>
    body?: unknown
    signal?: AbortSignal
    throwOnError?: boolean
    fetchFn?: typeof fetch
    headers?: HeadersInit
  } = {},
): Promise<ApiResponse<T>> {
  const fetchFn = opts.fetchFn ?? fetch

  let url = `${baseUrl}${path}`
  if (opts.query) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) {
        params.set(k, String(v))
      }
    }
    const qs = params.toString()
    if (qs) url += `?${qs}`
  }

  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> | undefined),
  }
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json"
  }

  const response = await fetchFn(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  })

  if (!response.ok && opts.throwOnError) {
    const text = await response.text().catch(() => "")
    throw new Error(`API error ${response.status}: ${text}`)
  }

  let data: T
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    data = (await response.json()) as T
  } else {
    data = undefined as unknown as T
  }

  return ok(data, response)
}

// SSE streaming helper
async function* streamSSE<T>(
  baseUrl: string,
  path: string,
  opts: {
    query?: Record<string, string | undefined>
    signal?: AbortSignal
    fetchFn?: typeof fetch
    headers?: HeadersInit
  } = {},
): AsyncIterable<T> {
  const fetchFn = opts.fetchFn ?? fetch

  let url = `${baseUrl}${path}`
  if (opts.query) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) params.set(k, v)
    }
    const qs = params.toString()
    if (qs) url += `?${qs}`
  }

  const response = await fetchFn(url, {
    method: "GET",
    headers: { Accept: "text/event-stream", ...(opts.headers as Record<string, string> | undefined) },
    signal: opts.signal,
  })

  if (!response.ok || !response.body) {
    throw new Error(`SSE error ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split("\n\n")
      buffer = parts.pop() ?? ""

      for (const block of parts) {
        const lines = block.split("\n")
        let dataLine = ""
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            dataLine = line.slice(6)
          }
        }
        if (dataLine && dataLine !== "[DONE]") {
          try {
            yield JSON.parse(dataLine) as T
          } catch {
            // ignore parse errors
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ──────────────────────────────────────────────────────────────────────────────

export class NekoClient {
  private baseUrl: string
  private cfg: NekoClientConfig

  constructor(cfg: NekoClientConfig = {}) {
    this.baseUrl = (cfg.baseUrl ?? "http://localhost:3000").replace(/\/$/, "")
    this.cfg = cfg
  }

  private q(params: { directory?: string; workspace?: string } = {}): Record<string, string | undefined> {
    return {
      directory: params.directory ?? this.cfg.directory,
      workspace: params.workspace ?? this.cfg.experimental_workspaceID,
    }
  }

  private fetch<T>(method: string, path: string, opts: {
    query?: Record<string, string | number | boolean | undefined>
    body?: unknown
    signal?: AbortSignal
    throwOnError?: boolean
  } = {}): Promise<ApiResponse<T>> {
    return request<T>(this.baseUrl, method, path, {
      ...opts,
      fetchFn: this.cfg.fetch,
      headers: this.cfg.headers,
    })
  }

  // ── Global ────────────────────────────────────────────────────────────────

  get global() {
    const self = this
    return {
      event(opts: RequestOptions = {}): { stream: AsyncIterable<GlobalEvent> } {
        const stream = streamSSE<GlobalEvent>(self.baseUrl, "/global/event", {
          signal: opts.signal,
          fetchFn: self.cfg.fetch,
          headers: self.cfg.headers as Record<string, string> | undefined,
        })
        return { stream }
      },
      health(opts: RequestOptions = {}) {
        return self.fetch<unknown>("GET", "/global/health", opts)
      },
      dispose(opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/global/dispose", opts)
      },
      upgrade(_params: { target?: string } = {}, _opts: RequestOptions = {}) {
        return Promise.resolve({ data: { success: false, version: "" }, error: "not supported", response: new Response() })
      },
      config: {
        get(opts: RequestOptions = {}) {
          return self.fetch<Config>("GET", "/global/config", opts)
        },
        update(params: { config?: Config }, opts: RequestOptions = {}) {
          return self.fetch<Config>("PATCH", "/global/config", { ...opts, body: params.config })
        },
      },
    }
  }

  // ── App ───────────────────────────────────────────────────────────────────

  get app() {
    const self = this
    return {
      agents(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<Agent[]>("GET", "/agent", { query: self.q(params), ...opts })
      },
      skills(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<import("./types").SkillV2Info[]>("GET", "/skill", { query: self.q(params), ...opts })
      },
    }
  }

  // ── Config ────────────────────────────────────────────────────────────────

  get config() {
    const self = this
    return {
      get(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<Config>("GET", "/config", { query: self.q(params), ...opts })
      },
      update(params: { directory?: string; workspace?: string; config?: Config }, opts: RequestOptions = {}) {
        return self.fetch<Config>("PATCH", "/config", { query: self.q(params), body: params.config, ...opts })
      },
      providers(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<ProviderListResponse>("GET", "/config/providers", { query: self.q(params), ...opts })
      },
    }
  }

  // ── Provider ──────────────────────────────────────────────────────────────

  get provider() {
    const self = this
    return {
      list(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<ProviderListResponse>("GET", "/provider", { query: self.q(params), ...opts })
      },
      auth(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<Record<string, ProviderAuthMethod[]>>("GET", "/provider/auth", { query: self.q(params), ...opts })
      },
      oauth: {
        authorize(params: { providerID: string; directory?: string; workspace?: string; method?: number; inputs?: Record<string, string> }, opts: RequestOptions = {}) {
          return self.fetch<import("./types").ProviderAuthAuthorization>("POST", `/provider/${params.providerID}/oauth/authorize`, {
            query: self.q(params),
            body: { method: params.method, inputs: params.inputs },
            ...opts,
          })
        },
        callback(params: { providerID: string; directory?: string; workspace?: string; method?: number; code?: string }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", `/provider/${params.providerID}/oauth/callback`, {
            query: self.q(params),
            body: { method: params.method, code: params.code },
            ...opts,
          })
        },
      },
    }
  }

  // ── Session ───────────────────────────────────────────────────────────────

  get session() {
    const self = this
    return {
      list(params: { directory?: string; workspace?: string; start?: number; scope?: string; path?: string; search?: string; limit?: number } = {}, opts: RequestOptions = {}) {
        return self.fetch<Session[]>("GET", "/session", { query: { ...self.q(params), start: params.start, scope: params.scope, path: params.path, search: params.search, limit: params.limit }, ...opts })
      },
      get(params: { sessionID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<Session>("GET", `/session/${params.sessionID}`, { query: self.q(params), ...opts })
      },
      create(params: { directory?: string; workspace?: string; sessionID?: string; parentID?: string; agentID?: string; agent?: string; model?: { providerID?: string; id?: string; variant?: string; modelID?: string } }, opts: RequestOptions = {}) {
        return self.fetch<Session>("POST", "/session", { query: self.q(params), body: params, ...opts })
      },
      delete(params: { sessionID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("DELETE", `/session/${params.sessionID}`, { query: self.q(params), ...opts })
      },
      messages(params: { sessionID: string; directory?: string; workspace?: string; limit?: number; cursor?: string }, opts: RequestOptions = {}) {
        return self.fetch<import("./types").MessageWithParts[]>("GET", `/session/${params.sessionID}/message`, { query: { ...self.q(params), limit: params.limit, cursor: params.cursor }, ...opts })
      },
      prompt(params: { sessionID: string; directory?: string; workspace?: string; text?: string; files?: unknown[]; agents?: unknown[]; messageID?: string; agent?: string; model?: unknown; variant?: string; parts?: unknown[]; providerID?: string; modelID?: string }, opts: RequestOptions = {}) {
        return self.fetch<Message>("POST", `/session/${params.sessionID}/prompt`, { query: self.q(params), body: { text: params.text, files: params.files, agents: params.agents, messageID: params.messageID, agent: params.agent, model: params.model, variant: params.variant, parts: params.parts }, ...opts })
      },
      promptAsync(params: { sessionID: string; directory?: string; workspace?: string; noReply?: boolean; parts?: unknown[] }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", `/session/${params.sessionID}/prompt`, { query: self.q(params), body: { noReply: params.noReply, parts: params.parts }, ...opts })
      },
      shell(params: { sessionID: string; directory?: string; workspace?: string; command?: string; args?: string[]; cwd?: string; agent?: string; model?: { providerID?: string; modelID?: string } }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", `/session/${params.sessionID}/shell`, { query: self.q(params), body: { command: params.command, args: params.args, cwd: params.cwd, agent: params.agent, model: params.model }, ...opts })
      },
      command(params: { sessionID: string; directory?: string; workspace?: string; command?: string; args?: string[]; arguments?: string; agent?: string; model?: string; variant?: string; parts?: unknown[] }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", `/session/${params.sessionID}/command`, { query: self.q(params), body: { command: params.command, args: params.args, arguments: params.arguments, agent: params.agent, model: params.model, variant: params.variant, parts: params.parts }, ...opts })
      },
      unrevert(params: { sessionID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", `/session/${params.sessionID}/unrevert`, { query: self.q(params), ...opts })
      },
      abort(params: { sessionID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", `/session/${params.sessionID}/abort`, { query: self.q(params), ...opts })
      },
      status(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<Record<string, SessionStatus>>("GET", "/session/status", { query: self.q(params), ...opts })
      },
      diff(params: { sessionID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<SnapshotFileDiff[]>("GET", `/session/${params.sessionID}/diff`, { query: self.q(params), ...opts })
      },
      todo(params: { sessionID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<Todo[]>("GET", `/session/${params.sessionID}/todo`, { query: self.q(params), ...opts })
      },
      fork(params: { sessionID: string; directory?: string; workspace?: string; messageID?: string; partID?: string }, opts: RequestOptions = {}) {
        return self.fetch<Session>("POST", `/session/${params.sessionID}/fork`, { query: self.q(params), body: { messageID: params.messageID, partID: params.partID }, ...opts })
      },
      share(params: { sessionID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<{ share?: { url: string } }>("POST", `/session/${params.sessionID}/share`, { query: self.q(params), ...opts })
      },
      unshare(params: { sessionID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", `/session/${params.sessionID}/unshare`, { query: self.q(params), ...opts })
      },
      revert: {
        stage(params: { sessionID: string; directory?: string; workspace?: string; messageID?: string; partID?: string }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", `/session/${params.sessionID}/revert/stage`, { query: self.q(params), body: { messageID: params.messageID, partID: params.partID }, ...opts })
        },
        commit(params: { sessionID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", `/session/${params.sessionID}/revert/commit`, { query: self.q(params), ...opts })
        },
        clear(params: { sessionID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", `/session/${params.sessionID}/revert/clear`, { query: self.q(params), ...opts })
        },
      },
      update(params: { sessionID: string; directory?: string; workspace?: string; title?: string; agent?: string; model?: { id: string; providerID: string } }, opts: RequestOptions = {}) {
        return self.fetch<Session>("PATCH", `/session/${params.sessionID}`, { query: self.q(params), body: { title: params.title, agent: params.agent, model: params.model }, ...opts })
      },
      summarize(params: { sessionID: string; directory?: string; workspace?: string; modelID?: string; providerID?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", `/session/${params.sessionID}/summarize`, { query: self.q(params), body: { modelID: params.modelID, providerID: params.providerID }, ...opts })
      },
    }
  }

  // ── Message / Part ────────────────────────────────────────────────────────

  get part() {
    const self = this
    return {
      list(params: { sessionID: string; messageID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<Part[]>("GET", `/session/${params.sessionID}/message/${params.messageID}/part`, { query: self.q(params), ...opts })
      },
      delete(params: { sessionID: string; messageID: string; partID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("DELETE", `/session/${params.sessionID}/message/${params.messageID}/part/${params.partID}`, { query: self.q(params), ...opts })
      },
    }
  }

  // ── Permission ────────────────────────────────────────────────────────────

  get permission() {
    const self = this
    return {
      list(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<PermissionRequest[]>("GET", "/permission", { query: self.q(params), ...opts })
      },
      reply(params: { requestID: string; directory?: string; workspace?: string; reply?: "once" | "always" | "reject"; message?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", `/permission/${params.requestID}/reply`, { query: self.q(params), body: { reply: params.reply, message: params.message }, ...opts })
      },
    }
  }

  // ── Question ──────────────────────────────────────────────────────────────

  get question() {
    const self = this
    return {
      list(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<QuestionRequest[]>("GET", "/question", { query: self.q(params), ...opts })
      },
      reply(params: { requestID: string; directory?: string; workspace?: string; answers?: QuestionAnswer[] }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", `/question/${params.requestID}/reply`, { query: self.q(params), body: { answers: params.answers }, ...opts })
      },
      reject(params: { requestID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", `/question/${params.requestID}/reject`, { query: self.q(params), ...opts })
      },
    }
  }

  // ── Command ───────────────────────────────────────────────────────────────

  get command() {
    const self = this
    return {
      list(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<Command[]>("GET", "/command", { query: self.q(params), ...opts })
      },
    }
  }

  // ── LSP ───────────────────────────────────────────────────────────────────

  get lsp() {
    const self = this
    return {
      status(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<LspStatus[]>("GET", "/lsp", { query: self.q(params), ...opts })
      },
    }
  }

  // ── Formatter ─────────────────────────────────────────────────────────────

  get formatter() {
    const self = this
    return {
      status(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<FormatterStatus[]>("GET", "/formatter", { query: self.q(params), ...opts })
      },
    }
  }

  // ── MCP ───────────────────────────────────────────────────────────────────

  get mcp() {
    const self = this
    return {
      status(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<Record<string, McpStatus>>("GET", "/mcp", { query: self.q(params), ...opts })
      },
      connect(params: { name: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", `/mcp/${params.name}/connect`, { query: self.q(params), ...opts })
      },
      disconnect(params: { name: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", `/mcp/${params.name}/disconnect`, { query: self.q(params), ...opts })
      },
    }
  }

  // ── VCS ───────────────────────────────────────────────────────────────────

  get vcs() {
    const self = this
    return {
      get(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<VcsInfo | undefined>("GET", "/vcs", { query: self.q(params), ...opts })
      },
      status(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<VcsFileStatus[]>("GET", "/vcs/status", { query: self.q(params), ...opts })
      },
      diff(params: { directory?: string; workspace?: string; mode: "git" | "branch"; context?: number }, opts: RequestOptions = {}) {
        return self.fetch<VcsDiffResponses>("GET", "/vcs/diff", { query: { ...self.q(params), mode: params.mode, context: params.context }, ...opts })
      },
      apply(params: { directory?: string; workspace?: string; patch?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/vcs/apply", { query: self.q(params), body: { patch: params.patch }, ...opts })
      },
    }
  }

  // ── Path ──────────────────────────────────────────────────────────────────

  get path() {
    const self = this
    return {
      get(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<import("./types").Path>("GET", "/path", { query: self.q(params), ...opts })
      },
    }
  }

  // ── Project ───────────────────────────────────────────────────────────────

  get project() {
    const self = this
    return {
      list(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<import("./types").Project[]>("GET", "/project", { query: self.q(params), ...opts })
      },
      current(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<import("./types").Project>("GET", "/project/current", { query: self.q(params), ...opts })
      },
      directories(params: { projectID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<ProjectDirectories>("GET", `/project/${params.projectID}/directories`, { query: self.q(params), ...opts })
      },
      update(params: { projectID: string; directory?: string; workspace?: string; name?: string; icon?: import("./types").ProjectIcon; commands?: import("./types").ProjectCommands }, opts: RequestOptions = {}) {
        return self.fetch<import("./types").Project>("PATCH", `/project/${params.projectID}`, { query: self.q(params), body: { name: params.name, icon: params.icon, commands: params.commands }, ...opts })
      },
    }
  }

  // ── Experimental ──────────────────────────────────────────────────────────

  get experimental() {
    const self = this
    return {
      capabilities: {
        get(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
          return self.fetch<ExperimentalCapabilities>("GET", "/experimental/capabilities", { query: self.q(params), ...opts })
        },
      },
      console: {
        get(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
          return self.fetch<ConsoleState>("GET", "/experimental/console", { query: self.q(params), ...opts })
        },
        listOrgs(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
          return self.fetch<import("./types").ExperimentalConsoleListOrgsResponse>("GET", "/experimental/console/orgs", { query: self.q(params), ...opts })
        },
        switchOrg(params: { directory?: string; workspace?: string; accountID?: string; orgID?: string }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", "/experimental/console/switch", { query: self.q(params), body: { accountID: params.accountID, orgID: params.orgID }, ...opts })
        },
      },
      resource: {
        list(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
          return self.fetch<Record<string, McpResource>>("GET", "/experimental/resource", { query: self.q(params), ...opts })
        },
      },
      session: {
        list(params: { directory?: string; workspace?: string; start?: number; cursor?: number; search?: string; limit?: number; roots?: boolean; archived?: boolean } = {}, opts: RequestOptions = {}) {
          return self.fetch<Session[]>("GET", "/experimental/session", { query: { ...self.q(params), start: params.start, cursor: params.cursor, search: params.search, limit: params.limit, roots: params.roots, archived: params.archived }, ...opts })
        },
        background(params: { sessionID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", `/experimental/session/${params.sessionID}/background`, { query: self.q(params), ...opts })
        },
      },
      workspace: {
        list(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
          return self.fetch<Workspace[]>("GET", "/experimental/workspace", { query: self.q(params), ...opts })
        },
        create(params: { directory?: string; workspace?: string; id?: string; type?: string; branch?: string | null }, opts: RequestOptions = {}) {
          return self.fetch<Workspace>("POST", "/experimental/workspace", { query: self.q(params), body: { id: params.id, type: params.type, branch: params.branch }, ...opts })
        },
        remove(params: { id: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("DELETE", `/experimental/workspace/${params.id}`, { query: self.q(params), ...opts })
        },
        status(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
          return self.fetch<import("./types").WorkspaceEventConnectionStatus[]>("GET", "/experimental/workspace/status", { query: self.q(params), ...opts })
        },
        warp(params: { directory?: string; workspace?: string; id?: string | null; sessionID?: string; copyChanges?: boolean } = {}, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", "/experimental/workspace/warp", { query: self.q(params), body: { id: params.id, sessionID: params.sessionID, copyChanges: params.copyChanges }, ...opts })
        },
        syncList(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", "/experimental/workspace/sync-list", { query: self.q(params), ...opts })
        },
        adapter: {
          list(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
            return self.fetch<import("./types").ExperimentalWorkspaceAdapterListResponse>("GET", "/experimental/workspace/adapter", { query: self.q(params), ...opts })
          },
        },
      },
      worktree: {
        list(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
          return self.fetch<Worktree[]>("GET", "/experimental/worktree", { query: self.q(params), ...opts })
        },
        create(params: { directory?: string; workspace?: string; name?: string; startCommand?: string }, opts: RequestOptions = {}) {
          return self.fetch<Worktree>("POST", "/experimental/worktree", { query: self.q(params), body: { name: params.name, startCommand: params.startCommand }, ...opts })
        },
        remove(params: { directory?: string; workspace?: string; worktreeRemoveInput?: import("./types").WorktreeRemoveInput }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("DELETE", "/experimental/worktree", { query: self.q(params), body: params.worktreeRemoveInput, ...opts })
        },
        reset(params: { directory?: string; workspace?: string; worktreeResetInput?: import("./types").WorktreeResetInput }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", "/experimental/worktree/reset", { query: self.q(params), body: params.worktreeResetInput, ...opts })
        },
      },
      projectCopy: {
        generateName(params: { projectID: string; directory?: string; workspace?: string; context?: string }, opts: RequestOptions = {}) {
          return self.fetch<{ name: string }>("POST", `/experimental/project/${params.projectID}/copy/generate-name`, { query: self.q(params), body: { context: params.context }, ...opts })
        },
      },
      controlPlane: {
        session: {
          list(params: { directory?: string; workspace?: string; limit?: number; cursor?: string } = {}, opts: RequestOptions = {}) {
            return self.fetch<{ data: import("./types").Session[]; cursor?: { next?: string } }>("GET", "/experimental/control-plane/session", { query: { ...self.q(params), limit: params.limit, cursor: params.cursor }, ...opts })
          },
        },
        moveSession(params: { sessionID: string; destination?: { directory?: string }; moveChanges?: boolean; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", `/experimental/control-plane/session/${params.sessionID}/move`, { query: self.q(params), body: { destination: params.destination, moveChanges: params.moveChanges }, ...opts })
        },
      },
    }
  }

  // ── Pty ───────────────────────────────────────────────────────────────────

  get pty() {
    const self = this
    return {
      shells(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<unknown[]>("GET", "/pty/shells", { query: self.q(params), ...opts })
      },
      list(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<import("./types").Pty[]>("GET", "/pty", { query: self.q(params), ...opts })
      },
      create(params: { directory?: string; workspace?: string; command?: string; args?: string[]; cwd?: string; title?: string; env?: Record<string, string> }, opts: RequestOptions = {}) {
        return self.fetch<import("./types").Pty>("POST", "/pty", { query: self.q(params), body: { command: params.command, args: params.args, cwd: params.cwd, title: params.title, env: params.env }, ...opts })
      },
      remove(params: { ptyID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("DELETE", `/pty/${params.ptyID}`, { query: self.q(params), ...opts })
      },
      get(params: { ptyID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<import("./types").Pty>("GET", `/pty/${params.ptyID}`, { query: self.q(params), ...opts })
      },
      update(params: { ptyID: string; directory?: string; workspace?: string; title?: string; size?: { rows: number; cols: number } }, opts: RequestOptions = {}) {
        return self.fetch<import("./types").Pty>("PUT", `/pty/${params.ptyID}`, { query: self.q(params), body: { title: params.title, size: params.size }, ...opts })
      },
      connectToken(params: { ptyID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<import("./types").PtyTicketConnectToken>("POST", `/pty/${params.ptyID}/connect-token`, { query: self.q(params), ...opts })
      },
      connect(params: { ptyID: string; directory?: string; workspace?: string; cursor?: string; ticket?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("GET", `/pty/${params.ptyID}/connect`, { query: { ...self.q(params), cursor: params.cursor, ticket: params.ticket }, ...opts })
      },
    }
  }

  // ── File ──────────────────────────────────────────────────────────────────

  get file() {
    const self = this
    return {
      list(params: { directory?: string; workspace?: string; path: string }, opts: RequestOptions = {}) {
        return self.fetch<import("./types").FileNode[]>("GET", "/file", { query: { ...self.q(params), path: params.path }, ...opts })
      },
      read(params: { directory?: string; workspace?: string; path: string }, opts: RequestOptions = {}) {
        return self.fetch<import("./types").FileContent>("GET", "/file/content", { query: { ...self.q(params), path: params.path }, ...opts })
      },
      status(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<import("./types").File[]>("GET", "/file/status", { query: self.q(params), ...opts })
      },
    }
  }

  // ── Find ──────────────────────────────────────────────────────────────────

  get find() {
    const self = this
    return {
      text(params: { directory?: string; workspace?: string; pattern: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("GET", "/find", { query: { ...self.q(params), pattern: params.pattern }, ...opts })
      },
      files(params: { directory?: string; workspace?: string; query: string; limit?: number }, opts: RequestOptions = {}) {
        return self.fetch<string[]>("GET", "/find/file", { query: { ...self.q(params), query: params.query, limit: params.limit }, ...opts })
      },
      symbols(params: { directory?: string; workspace?: string; query: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("GET", "/find/symbol", { query: { ...self.q(params), query: params.query }, ...opts })
      },
    }
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  get auth() {
    const self = this
    return {
      set(params: { providerID: string; auth?: import("./types").Auth }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("PUT", `/auth/${params.providerID}`, { body: params.auth, ...opts })
      },
      remove(params: { providerID: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("DELETE", `/auth/${params.providerID}`, opts)
      },
    }
  }

  // ── Instance ──────────────────────────────────────────────────────────────

  get instance() {
    const self = this
    return {
      dispose(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/instance/dispose", { query: self.q(params), ...opts })
      },
    }
  }

  // ── Sync ──────────────────────────────────────────────────────────────────

  get sync() {
    const self = this
    return {
      start(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/sync/start", { query: self.q(params), ...opts })
      },
      history: {
        list(params: { sessionID: string; directory?: string; workspace?: string; cursor?: string; limit?: number }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("GET", `/sync/history/${params.sessionID}`, { query: { ...self.q(params), cursor: params.cursor, limit: params.limit }, ...opts })
        },
      },
      replay(params: { sessionID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", `/sync/replay/${params.sessionID}`, { query: self.q(params), ...opts })
      },
      steal(params: { sessionID: string; directory?: string; workspace?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", `/sync/steal/${params.sessionID}`, { query: self.q(params), ...opts })
      },
    }
  }

  // ── Tui ───────────────────────────────────────────────────────────────────

  get tui() {
    const self = this
    return {
      publish(params: { directory?: string; workspace?: string; event?: unknown }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/tui/publish", { query: self.q(params), body: params.event, ...opts })
      },
      appendPrompt(params: { directory?: string; workspace?: string; text?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/tui/prompt/append", { query: self.q(params), body: { text: params.text }, ...opts })
      },
      clearPrompt(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/tui/prompt/clear", { query: self.q(params), ...opts })
      },
      submitPrompt(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/tui/prompt/submit", { query: self.q(params), ...opts })
      },
      executeCommand(params: { directory?: string; workspace?: string; command?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/tui/command/execute", { query: self.q(params), body: { command: params.command }, ...opts })
      },
      selectSession(params: { directory?: string; workspace?: string; sessionID?: string }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/tui/session/select", { query: self.q(params), body: { sessionID: params.sessionID }, ...opts })
      },
      showToast(params: { directory?: string; workspace?: string; title?: string; message?: string; variant?: string; duration?: number }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/tui/toast/show", { query: self.q(params), body: params, ...opts })
      },
      openHelp(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/tui/help", { query: self.q(params), ...opts })
      },
      openModels(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/tui/models", { query: self.q(params), ...opts })
      },
      openSessions(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/tui/sessions", { query: self.q(params), ...opts })
      },
      openThemes(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/tui/themes", { query: self.q(params), ...opts })
      },
      controlNext(params: { directory?: string; workspace?: string } = {}, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/tui/control/next", { query: self.q(params), ...opts })
      },
      controlResponse(params: { directory?: string; workspace?: string; response?: unknown }, opts: RequestOptions = {}) {
        return self.fetch<unknown>("POST", "/tui/control/response", { query: self.q(params), body: params.response, ...opts })
      },
    }
  }

  // ── V2 ────────────────────────────────────────────────────────────────────

  get v2() {
    const self = this
    return {
      health: {
        get(params: { location?: { directory?: string; workspace?: string } } = {}, opts: RequestOptions = {}) {
          return self.fetch<unknown>("GET", "/v2/health", { query: self.q(params.location ?? {}), ...opts })
        },
      },
      location: {
        get(params: { location?: { directory?: string; workspace?: string } } = {}, opts: RequestOptions = {}) {
          return self.fetch<import("./types").LocationInfo>("GET", "/v2/location", { query: self.q(params.location ?? {}), ...opts })
        },
      },
      agent: {
        list(params: { location?: { directory?: string; workspace?: string } } = {}, opts: RequestOptions = {}) {
          return self.fetch<{ location: import("./types").LocationRef; data: import("./types").AgentV2Info[] }>("GET", "/v2/agent", { query: self.q(params.location ?? {}), ...opts })
        },
      },
      model: {
        list(params: { location?: { directory?: string; workspace?: string } } = {}, opts: RequestOptions = {}) {
          return self.fetch<{ location: import("./types").LocationRef; data: import("./types").ModelV2Info[] }>("GET", "/v2/model", { query: self.q(params.location ?? {}), ...opts })
        },
      },
      provider: {
        list(params: { location?: { directory?: string; workspace?: string } } = {}, opts: RequestOptions = {}) {
          return self.fetch<{ location: import("./types").LocationRef; data: import("./types").ProviderV2Info[] }>("GET", "/v2/provider", { query: self.q(params.location ?? {}), ...opts })
        },
        get(params: { providerID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
          return self.fetch<import("./types").ProviderV2Info>("GET", `/v2/provider/${params.providerID}`, { query: self.q(params.location ?? {}), ...opts })
        },
      },
      integration: {
        list(params: { location?: { directory?: string; workspace?: string } } = {}, opts: RequestOptions = {}) {
          return self.fetch<{ location: import("./types").LocationRef; data: import("./types").IntegrationInfo[] }>("GET", "/v2/integration", { query: self.q(params.location ?? {}), ...opts })
        },
        get(params: { integrationID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
          return self.fetch<import("./types").IntegrationInfo>("GET", `/v2/integration/${params.integrationID}`, { query: self.q(params.location ?? {}), ...opts })
        },
        attempt: {
          status(params: { attemptID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
            return self.fetch<import("./types").IntegrationAttemptStatus>("GET", `/v2/integration/attempt/${params.attemptID}`, { query: self.q(params.location ?? {}), ...opts })
          },
          cancel(params: { attemptID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
            return self.fetch<unknown>("POST", `/v2/integration/attempt/${params.attemptID}/cancel`, { query: self.q(params.location ?? {}), ...opts })
          },
          complete(params: { attemptID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
            return self.fetch<unknown>("POST", `/v2/integration/attempt/${params.attemptID}/complete`, { query: self.q(params.location ?? {}), ...opts })
          },
        },
        connect: {
          oauth(params: { integrationID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
            return self.fetch<import("./types").IntegrationAttempt>("POST", `/v2/integration/${params.integrationID}/connect/oauth`, { query: self.q(params.location ?? {}), ...opts })
          },
          key(params: { integrationID: string; location?: { directory?: string; workspace?: string }; inputs?: Record<string, string> }, opts: RequestOptions = {}) {
            return self.fetch<unknown>("POST", `/v2/integration/${params.integrationID}/connect/key`, { query: self.q(params.location ?? {}), body: { inputs: params.inputs }, ...opts })
          },
        },
      },
      credential: {
        remove(params: { providerID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("DELETE", `/v2/credential/${params.providerID}`, { query: self.q(params.location ?? {}), ...opts })
        },
        update(params: { providerID: string; location?: { directory?: string; workspace?: string }; value?: import("./types").CredentialValue }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("PUT", `/v2/credential/${params.providerID}`, { query: self.q(params.location ?? {}), body: params.value, ...opts })
        },
      },
      permission: {
        saved: {
          list(params: { projectID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
            return self.fetch<{ data: import("./types").PermissionSavedInfo[] }>("GET", `/v2/permission/saved/${params.projectID}`, { query: self.q(params.location ?? {}), ...opts })
          },
          remove(params: { id: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
            return self.fetch<unknown>("DELETE", `/v2/permission/saved/${params.id}`, { query: self.q(params.location ?? {}), ...opts })
          },
        },
        request: {
          list(params: { location?: { directory?: string; workspace?: string } } = {}, opts: RequestOptions = {}) {
            return self.fetch<{ data: import("./types").PermissionV2Request[] }>("GET", "/v2/permission/request", { query: self.q(params.location ?? {}), ...opts })
          },
          reply(params: { requestID: string; location?: { directory?: string; workspace?: string }; reply?: import("./types").PermissionV2Reply }, opts: RequestOptions = {}) {
            return self.fetch<unknown>("POST", `/v2/permission/request/${params.requestID}/reply`, { query: self.q(params.location ?? {}), body: { reply: params.reply }, ...opts })
          },
        },
      },
      session: {
        get(params: { sessionID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
          return self.fetch<{ data: import("./types").SessionV2Info }>("GET", `/v2/session/${params.sessionID}`, { query: self.q(params.location ?? {}), ...opts })
        },
        list(params: { location?: { directory?: string; workspace?: string }; cursor?: string; limit?: number; search?: string } = {}, opts: RequestOptions = {}) {
          return self.fetch<import("./types").SessionsResponse>("GET", "/v2/session", { query: { ...self.q(params.location ?? {}), cursor: params.cursor, limit: params.limit, search: params.search }, ...opts })
        },
        create(params: { location?: { directory?: string; workspace?: string }; agent?: string; title?: string }, opts: RequestOptions = {}) {
          return self.fetch<{ data: import("./types").SessionV2Info }>("POST", "/v2/session", { query: self.q(params.location ?? {}), body: { agent: params.agent, title: params.title }, ...opts })
        },
        prompt(params: { sessionID: string; location?: { directory?: string; workspace?: string }; text?: string; files?: unknown[]; agents?: unknown[]; messageID?: string }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", `/v2/session/${params.sessionID}/prompt`, { query: self.q(params.location ?? {}), body: { text: params.text, files: params.files, agents: params.agents, messageID: params.messageID }, ...opts })
        },
        interrupt(params: { sessionID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", `/v2/session/${params.sessionID}/interrupt`, { query: self.q(params.location ?? {}), ...opts })
        },
        wait(params: { sessionID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", `/v2/session/${params.sessionID}/wait`, { query: self.q(params.location ?? {}), ...opts })
        },
        compact(params: { sessionID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", `/v2/session/${params.sessionID}/compact`, { query: self.q(params.location ?? {}), ...opts })
        },
        context(params: { sessionID: string; location?: { directory?: string; workspace?: string }; text?: string }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", `/v2/session/${params.sessionID}/context`, { query: self.q(params.location ?? {}), body: { text: params.text }, ...opts })
        },
        switchAgent(params: { sessionID: string; location?: { directory?: string; workspace?: string }; agent?: string }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", `/v2/session/${params.sessionID}/switch-agent`, { query: self.q(params.location ?? {}), body: { agent: params.agent }, ...opts })
        },
        switchModel(params: { sessionID: string; location?: { directory?: string; workspace?: string }; model?: import("./types").ModelRef }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", `/v2/session/${params.sessionID}/switch-model`, { query: self.q(params.location ?? {}), body: { model: params.model }, ...opts })
        },
        messages(params: { sessionID: string; location?: { directory?: string; workspace?: string }; cursor?: string; limit?: number }, opts: RequestOptions = {}) {
          return self.fetch<{ data: import("./types").SessionMessage[] }>("GET", `/v2/session/${params.sessionID}/messages`, { query: { ...self.q(params.location ?? {}), cursor: params.cursor, limit: params.limit }, ...opts })
        },
        events(params: { sessionID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("GET", `/v2/session/${params.sessionID}/events`, { query: self.q(params.location ?? {}), ...opts })
        },
        history(params: { sessionID: string; location?: { directory?: string; workspace?: string }; cursor?: string; limit?: number }, opts: RequestOptions = {}) {
          return self.fetch<import("./types").SessionHistory>("GET", `/v2/session/${params.sessionID}/history`, { query: { ...self.q(params.location ?? {}), cursor: params.cursor, limit: params.limit }, ...opts })
        },
        active(params: { sessionID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("GET", `/v2/session/${params.sessionID}/active`, { query: self.q(params.location ?? {}), ...opts })
        },
        permission: {
          list(params: { sessionID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
            return self.fetch<{ data: import("./types").PermissionV2Request[] }>("GET", `/v2/session/${params.sessionID}/permission`, { query: self.q(params.location ?? {}), ...opts })
          },
          create(params: { sessionID: string; location?: { directory?: string; workspace?: string }; action?: string; resources?: string[]; save?: string[] }, opts: RequestOptions = {}) {
            return self.fetch<import("./types").PermissionV2Request>("POST", `/v2/session/${params.sessionID}/permission`, { query: self.q(params.location ?? {}), body: { action: params.action, resources: params.resources, save: params.save }, ...opts })
          },
          get(params: { sessionID: string; requestID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
            return self.fetch<import("./types").PermissionV2Request>("GET", `/v2/session/${params.sessionID}/permission/${params.requestID}`, { query: self.q(params.location ?? {}), ...opts })
          },
          reply(params: { sessionID: string; requestID: string; location?: { directory?: string; workspace?: string }; reply?: import("./types").PermissionV2Reply }, opts: RequestOptions = {}) {
            return self.fetch<unknown>("POST", `/v2/session/${params.sessionID}/permission/${params.requestID}/reply`, { query: self.q(params.location ?? {}), body: { reply: params.reply }, ...opts })
          },
        },
        question: {
          list(params: { sessionID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
            return self.fetch<{ data: import("./types").QuestionV2Request[] }>("GET", `/v2/session/${params.sessionID}/question`, { query: self.q(params.location ?? {}), ...opts })
          },
          reply(params: { sessionID: string; requestID: string; location?: { directory?: string; workspace?: string }; answers?: import("./types").QuestionV2Answer[] }, opts: RequestOptions = {}) {
            return self.fetch<unknown>("POST", `/v2/session/${params.sessionID}/question/${params.requestID}/reply`, { query: self.q(params.location ?? {}), body: { answers: params.answers }, ...opts })
          },
          reject(params: { sessionID: string; requestID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
            return self.fetch<unknown>("POST", `/v2/session/${params.sessionID}/question/${params.requestID}/reject`, { query: self.q(params.location ?? {}), ...opts })
          },
        },
        revert: {
          stage(params: { sessionID: string; location?: { directory?: string; workspace?: string }; messageID?: string; partID?: string }, opts: RequestOptions = {}) {
            return self.fetch<unknown>("POST", `/v2/session/${params.sessionID}/revert/stage`, { query: self.q(params.location ?? {}), body: { messageID: params.messageID, partID: params.partID }, ...opts })
          },
          commit(params: { sessionID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
            return self.fetch<unknown>("POST", `/v2/session/${params.sessionID}/revert/commit`, { query: self.q(params.location ?? {}), ...opts })
          },
          clear(params: { sessionID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
            return self.fetch<unknown>("POST", `/v2/session/${params.sessionID}/revert/clear`, { query: self.q(params.location ?? {}), ...opts })
          },
        },
      },
      fs: {
        list(params: { location?: { directory?: string; workspace?: string }; path?: string } = {}, opts: RequestOptions = {}) {
          return self.fetch<import("./types").FileSystemEntry[]>("GET", "/v2/fs", { query: { ...self.q(params.location ?? {}), path: params.path }, ...opts })
        },
        find(params: { location?: { directory?: string; workspace?: string }; query?: string; limit?: string | number } = {}, opts: RequestOptions = {}) {
          return self.fetch<{ location: import("./types").LocationRef; data: import("./types").FileSystemEntry[] }>("GET", "/v2/fs/find", { query: { ...self.q(params.location ?? {}), query: params.query, limit: params.limit }, ...opts })
        },
        read(params: { location?: { directory?: string; workspace?: string }; path?: string } = {}, opts: RequestOptions = {}) {
          return self.fetch<import("./types").FileContent>("GET", "/v2/fs/read", { query: { ...self.q(params.location ?? {}), path: params.path }, ...opts })
        },
      },
      command: {
        list(params: { location?: { directory?: string; workspace?: string } } = {}, opts: RequestOptions = {}) {
          return self.fetch<{ location: import("./types").LocationRef; data: import("./types").CommandV2Info[] }>("GET", "/v2/command", { query: self.q(params.location ?? {}), ...opts })
        },
      },
      skill: {
        list(params: { location?: { directory?: string; workspace?: string } } = {}, opts: RequestOptions = {}) {
          return self.fetch<{ location: import("./types").LocationRef; data: import("./types").SkillV2Info[] }>("GET", "/v2/skill", { query: self.q(params.location ?? {}), ...opts })
        },
      },
      event: {
        subscribe(params: { location?: { directory?: string; workspace?: string } } = {}, opts: RequestOptions = {}) {
          return self.fetch<unknown>("GET", "/v2/event", { query: self.q(params.location ?? {}), ...opts })
        },
      },
      pty: {
        list(params: { location?: { directory?: string; workspace?: string } } = {}, opts: RequestOptions = {}) {
          return self.fetch<import("./types").Pty[]>("GET", "/v2/pty", { query: self.q(params.location ?? {}), ...opts })
        },
        create(params: { location?: { directory?: string; workspace?: string }; command?: string; args?: string[]; cwd?: string; title?: string; env?: Record<string, string> }, opts: RequestOptions = {}) {
          return self.fetch<import("./types").Pty>("POST", "/v2/pty", { query: self.q(params.location ?? {}), body: { command: params.command, args: params.args, cwd: params.cwd, title: params.title, env: params.env }, ...opts })
        },
        get(params: { ptyID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
          return self.fetch<import("./types").Pty>("GET", `/v2/pty/${params.ptyID}`, { query: self.q(params.location ?? {}), ...opts })
        },
        remove(params: { ptyID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("DELETE", `/v2/pty/${params.ptyID}`, { query: self.q(params.location ?? {}), ...opts })
        },
        update(params: { ptyID: string; location?: { directory?: string; workspace?: string }; title?: string; size?: { rows: number; cols: number } }, opts: RequestOptions = {}) {
          return self.fetch<import("./types").Pty>("PATCH", `/v2/pty/${params.ptyID}`, { query: self.q(params.location ?? {}), body: { title: params.title, size: params.size }, ...opts })
        },
        connectToken(params: { ptyID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
          return self.fetch<import("./types").PtyTicketConnectToken>("POST", `/v2/pty/${params.ptyID}/connect-token`, { query: self.q(params.location ?? {}), ...opts })
        },
        connect(params: { ptyID: string; location?: { directory?: string; workspace?: string }; cursor?: string; ticket?: string }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("GET", `/v2/pty/${params.ptyID}/connect`, { query: { ...self.q(params.location ?? {}), cursor: params.cursor, ticket: params.ticket }, ...opts })
        },
      },
      question: {
        request: {
          list(params: { location?: { directory?: string; workspace?: string } } = {}, opts: RequestOptions = {}) {
            return self.fetch<{ data: import("./types").QuestionV2Request[] }>("GET", "/v2/question", { query: self.q(params.location ?? {}), ...opts })
          },
        },
      },
      reference: {
        list(params: { location?: { directory?: string; workspace?: string } } = {}, opts: RequestOptions = {}) {
          return self.fetch<{ location: import("./types").LocationRef; data: import("./types").ReferenceInfo[] }>("GET", "/v2/reference", { query: self.q(params.location ?? {}), ...opts })
        },
      },
      projectCopy: {
        generateName(params: { projectID: string; location?: { directory?: string; workspace?: string }; context?: string }, opts: RequestOptions = {}) {
          return self.fetch<{ name: string }>("POST", `/v2/project/${params.projectID}/copy/generate-name`, { query: self.q(params.location ?? {}), body: { context: params.context }, ...opts })
        },
        create(params: { projectID: string; location?: { directory?: string; workspace?: string }; strategy?: string; directory?: string; name?: string }, opts: RequestOptions = {}) {
          return self.fetch<import("./types").ProjectCopyCopy>("POST", `/v2/project/${params.projectID}/copy`, { query: self.q(params.location ?? {}), body: { strategy: params.strategy, directory: params.directory, name: params.name }, ...opts })
        },
        remove(params: { projectID: string; location?: { directory?: string; workspace?: string }; directory?: string; force?: boolean }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("DELETE", `/v2/project/${params.projectID}/copy`, { query: self.q(params.location ?? {}), body: { directory: params.directory, force: params.force }, ...opts })
        },
        refresh(params: { projectID: string; location?: { directory?: string; workspace?: string } }, opts: RequestOptions = {}) {
          return self.fetch<unknown>("POST", `/v2/project/${params.projectID}/copy/refresh`, { query: self.q(params.location ?? {}), ...opts })
        },
      },
    }
  }
}

export function createNekoClient(config?: NekoClientConfig): NekoClient {
  return new NekoClient(config)
}
