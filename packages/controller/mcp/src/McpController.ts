/**
 * McpController — Effect service managing MCP client connections.
 *
 * Ported from packages/neko/src/mcp/index.ts.
 *
 * Manages stdio and HTTP-based MCP clients, tool discovery, OAuth flows,
 * and connection lifecycle. Replaces neko-specific deps (InstanceState,
 * EffectBridge, Config.Service, EventV2Bridge) with standalone equivalents
 * suitable for @gco/controller-mcp.
 */
export * as McpController from "./McpController"

import path from "node:path"
import { pathToFileURL } from "node:url"
import { Client, type ClientOptions } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import {
  ListRootsRequestSchema,
  type LoggingMessageNotification,
  LoggingMessageNotificationSchema,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { Cause, Context, Effect, Exit, Layer, Schema } from "effect"
import { McpAuthController } from "./McpAuthController"
import { McpCatalogController } from "./McpCatalogController"
import { McpOAuthCallback } from "./oauth-callback"
import {
  McpOAuthProvider,
  McpOAuthPendingProvider,
  OAUTH_CALLBACK_PATH,
  type McpOAuthConfig,
} from "./oauth-provider"
import type { McpConfig } from "./mcp-config"
import open from "open"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 30_000
const CLIENT_OPTIONS = {
  capabilities: {
    roots: {},
  },
} satisfies ClientOptions

// ---------------------------------------------------------------------------
// Public schema types
// ---------------------------------------------------------------------------

export const Resource = Schema.Struct({
  name: Schema.String,
  uri: Schema.String,
  description: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  client: Schema.String,
}).annotate({ identifier: "McpResource" })
export type Resource = Schema.Schema.Type<typeof Resource>

export const StatusConnected = Schema.Struct({ status: Schema.Literal("connected") })
export const StatusDisabled = Schema.Struct({ status: Schema.Literal("disabled") })
export const StatusFailed = Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String })
export const StatusNeedsAuth = Schema.Struct({ status: Schema.Literal("needs_auth") })
export const StatusNeedsClientRegistration = Schema.Struct({
  status: Schema.Literal("needs_client_registration"),
  error: Schema.String,
})

export const Status = Schema.Union([
  StatusConnected,
  StatusDisabled,
  StatusFailed,
  StatusNeedsAuth,
  StatusNeedsClientRegistration,
]).annotate({ identifier: "MCPStatus", discriminator: "status" })
export type Status = Schema.Schema.Type<typeof Status>

export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type MCPClient = Client
type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport

// Pending OAuth transports awaiting finishAuth()
const pendingOAuthTransports = new Map<string, { transport: TransportWithAuth; provider?: McpOAuthPendingProvider }>()

type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]
type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
type ResourceTemplateInfo = Awaited<ReturnType<MCPClient["listResourceTemplates"]>>["resourceTemplates"][number]

function isMcpConfigured(entry: unknown): entry is McpConfig.Info {
  return typeof entry === "object" && entry !== null && "type" in entry
}

function remoteURL(value: string): URL | undefined {
  if (URL.canParse(value)) return new URL(value)
  return undefined
}

interface CreateResult {
  mcpClient?: MCPClient
  status: Status
  defs?: MCPToolDef[]
  instructions?: string
}

interface AuthResult {
  authorizationUrl: string
  oauthState: string
  client?: MCPClient
}

// ---------------------------------------------------------------------------
// MCP state shape
// ---------------------------------------------------------------------------

interface State {
  /** Configs added at runtime via add() */
  config: Record<string, McpConfig.Info>
  status: Record<string, Status>
  clients: Record<string, MCPClient>
  defs: Record<string, MCPToolDef[]>
  instructions: Record<string, string>
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ServerInstructions {
  name: string
  instructions: string
  tools: string[]
}

export interface McpTool {
  readonly def: MCPToolDef
  readonly client: MCPClient
  readonly timeout?: number
}

/** Callbacks fired by McpController on notable events. */
export interface McpControllerCallbacks {
  /** Called when a server emits a tools-changed notification. */
  onToolsChanged?: (server: string) => void
  /** Called when browser open for OAuth fails; provides fallback URL. */
  onBrowserOpenFailed?: (mcpName: string, url: string) => void
  /** Called when an MCP server needs authentication. */
  onNeedsAuth?: (server: string, message: string) => void
}

export interface Interface {
  readonly status: () => Effect.Effect<Record<string, Status>>
  readonly clients: () => Effect.Effect<Record<string, MCPClient>>
  readonly instructions: () => Effect.Effect<ServerInstructions[]>
  readonly tools: () => Effect.Effect<Record<string, McpTool>>
  readonly prompts: () => Effect.Effect<Record<string, PromptInfo & { client: string }>>
  readonly resources: (clientName?: string) => Effect.Effect<Record<string, ResourceInfo & { client: string }>>
  readonly resourceTemplates: (
    clientName?: string,
  ) => Effect.Effect<Record<string, ResourceTemplateInfo & { client: string }>>
  readonly config: () => Effect.Effect<Record<string, McpConfig.Info>>
  readonly serverDefs: () => Effect.Effect<Record<string, string[]>>
  readonly add: (
    name: string,
    mcp: McpConfig.Info,
  ) => Effect.Effect<{ status: Record<string, Status> | Status }>
  readonly connect: (name: string) => Effect.Effect<void, NotFoundError>
  readonly disconnect: (name: string) => Effect.Effect<void, NotFoundError>
  /** Fully remove a server (closes the client and purges config/status/defs). */
  readonly remove: (name: string) => Effect.Effect<void>
  readonly getPrompt: (
    clientName: string,
    name: string,
    args?: Record<string, string>,
  ) => Effect.Effect<Awaited<ReturnType<MCPClient["getPrompt"]>> | undefined>
  readonly readResource: (
    clientName: string,
    resourceUri: string,
  ) => Effect.Effect<Awaited<ReturnType<MCPClient["readResource"]>> | undefined>
  readonly startAuth: (
    mcpName: string,
  ) => Effect.Effect<{ authorizationUrl: string; oauthState: string }, NotFoundError>
  readonly authenticate: (
    mcpName: string,
    onAuthorization?: (authorizationUrl: string) => void,
  ) => Effect.Effect<Status, NotFoundError>
  readonly finishAuth: (mcpName: string, authorizationCode: string) => Effect.Effect<Status, NotFoundError>
  readonly removeAuth: (mcpName: string) => Effect.Effect<void>
  readonly supportsOAuth: (mcpName: string) => Effect.Effect<boolean, NotFoundError>
  readonly hasStoredTokens: (mcpName: string) => Effect.Effect<boolean>
  readonly getAuthStatus: (mcpName: string) => Effect.Effect<AuthStatus>
  /** Load an initial set of MCP configs (e.g. from neko.json). */
  readonly loadConfig: (
    configs: Record<string, McpConfig.Info>,
    directory: string,
    options?: { defaultTimeout?: number },
  ) => Effect.Effect<void>
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("MCP.NotFoundError", {
  name: Schema.String,
}) {}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class Service extends Context.Service<Service, Interface>()("@gco/McpController") {}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

function createClient(directory: string): MCPClient {
  const client = new Client({ name: "neko", version: "0.1.0" }, CLIENT_OPTIONS)
  client.setRequestHandler(ListRootsRequestSchema, () =>
    Promise.resolve({ roots: [{ uri: pathToFileURL(directory).href }] }),
  )
  return client
}

// ---------------------------------------------------------------------------
// Timeout helper (replaces @/util/timeout)
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export function makeLayer(
  initialDirectory: string,
  mcpCallbacks: McpControllerCallbacks = {},
): Layer.Layer<Service, never, McpAuthController.Service> {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const auth = yield* McpAuthController.Service

      // Mutable working directory — may be updated via loadConfig
      let workingDirectory = initialDirectory

      const s: State = {
        config: {},
        status: {},
        clients: {},
        defs: {},
        instructions: {},
      }

      // -----------------------------------------------------------------------
      // Transport connection
      // -----------------------------------------------------------------------

      const connectTransport = Effect.fn("McpController.connectTransport")(function* (
        transport: StdioClientTransport | TransportWithAuth,
        timeout: number,
      ) {
        return yield* Effect.acquireUseRelease(
          Effect.succeed(transport),
          (t) =>
            Effect.tryPromise({
              try: () => {
                const client = createClient(workingDirectory)
                return withTimeout(client.connect(t), timeout).then(() => client)
              },
              catch: (e) => (e instanceof Error ? e : new Error(String(e))),
            }),
          (t, exit) =>
            Exit.isFailure(exit) ? Effect.tryPromise(() => t.close()).pipe(Effect.ignore) : Effect.void,
        )
      })

      const DISABLED_RESULT: CreateResult = { status: { status: "disabled" } }

      // -----------------------------------------------------------------------
      // Remote connection
      // -----------------------------------------------------------------------

      const connectRemote = Effect.fn("McpController.connectRemote")(function* (
        key: string,
        mcp: McpConfig.Remote,
      ) {
        const oauthDisabled = mcp.oauth === false
        const oauthConfig = typeof mcp.oauth === "object" ? (mcp.oauth as McpOAuthConfig) : undefined
        const url = remoteURL(mcp.url)
        if (!url) {
          return {
            client: undefined as MCPClient | undefined,
            status: { status: "failed" as const, error: `Invalid MCP URL for "${key}"` } satisfies Status,
          }
        }

        let authProvider: McpOAuthProvider | undefined
        if (!oauthDisabled) {
          authProvider = new McpOAuthProvider(
            key,
            mcp.url,
            {
              clientId: oauthConfig?.clientId,
              clientSecret: oauthConfig?.clientSecret,
              scope: oauthConfig?.scope,
              callbackPort: oauthConfig?.callbackPort,
              redirectUri: oauthConfig?.redirectUri,
            },
            { onRedirect: async () => {} },
            auth,
          )
        }

        const transports: Array<{ name: string; transport: TransportWithAuth }> = [
          {
            name: "StreamableHTTP",
            transport: new StreamableHTTPClientTransport(url, {
              authProvider,
              requestInit: mcp.headers ? { headers: mcp.headers as Record<string, string> } : undefined,
            }),
          },
          {
            name: "SSE",
            transport: new SSEClientTransport(url, {
              authProvider,
              requestInit: mcp.headers ? { headers: mcp.headers as Record<string, string> } : undefined,
            }),
          },
        ]

        const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
        let lastStatus: Status | undefined

        for (const { transport } of transports) {
          const result = yield* connectTransport(transport, connectTimeout).pipe(
            Effect.map((client) => ({ client })),
            Effect.catch((error) => {
              const lastError = error instanceof Error ? error : new Error(String(error))
              const isAuthError =
                error instanceof UnauthorizedError || (authProvider && lastError.message.includes("OAuth"))

              if (isAuthError) {
                if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
                  lastStatus = {
                    status: "needs_client_registration" as const,
                    error: "Server does not support dynamic client registration. Please provide clientId in config.",
                  }
                  mcpCallbacks.onNeedsAuth?.(
                    key,
                    `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                  )
                } else {
                  pendingOAuthTransports.set(key, { transport })
                  lastStatus = { status: "needs_auth" as const }
                  mcpCallbacks.onNeedsAuth?.(
                    key,
                    `Server "${key}" requires authentication. Run: neko mcp auth ${key}`,
                  )
                }
                return Effect.succeed(undefined)
              }

              lastStatus = { status: "failed" as const, error: lastError.message }
              return Effect.succeed(undefined)
            }),
          )
          if (result) return { client: result.client, status: { status: "connected" } as Status }
          if (lastStatus?.status === "needs_auth" || lastStatus?.status === "needs_client_registration") break
        }

        return {
          client: undefined as MCPClient | undefined,
          status: (lastStatus ?? { status: "failed", error: "Unknown error" }) as Status,
        }
      })

      // -----------------------------------------------------------------------
      // Local (stdio) connection
      // -----------------------------------------------------------------------

      const connectLocal = Effect.fn("McpController.connectLocal")(function* (
        key: string,
        mcp: McpConfig.Local,
      ) {
        const [cmd, ...args] = mcp.command
        const cwd = mcp.cwd ? path.resolve(workingDirectory, mcp.cwd) : workingDirectory
        const transport = new StdioClientTransport({
          stderr: "pipe",
          command: cmd!,
          args,
          cwd,
          env: {
            ...process.env,
            ...(cmd === "neko" ? { BUN_BE_BUN: "1" } : {}),
            ...mcp.environment,
          },
        })

        const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
        return yield* connectTransport(transport, connectTimeout).pipe(
          Effect.map(
            (client): { client: MCPClient | undefined; status: Status } => ({
              client,
              status: { status: "connected" },
            }),
          ),
          Effect.catch(
            (error): Effect.Effect<{ client: MCPClient | undefined; status: Status }> => {
              const msg = error instanceof Error ? error.message : String(error)
              return Effect.succeed({ client: undefined, status: { status: "failed", error: msg } })
            },
          ),
        )
      })

      // -----------------------------------------------------------------------
      // create() — attempt to connect and list tools
      // -----------------------------------------------------------------------

      const create = Effect.fn(
        "McpController.create",
      )(
        function* (key: string, mcp: McpConfig.Info) {
          if (mcp.enabled === false) return DISABLED_RESULT

          const { client: mcpClient, status } =
            mcp.type === "remote"
              ? yield* connectRemote(key, mcp as McpConfig.Remote)
              : yield* connectLocal(key, mcp as McpConfig.Local)

          if (!mcpClient) {
            if (status.status !== "connected" && status.status !== "disabled") {
              yield* Effect.logWarning("server unavailable", { key, type: mcp.type, status: status.status })
            }
            return { status } satisfies CreateResult
          }

          return yield* Effect.gen(function* () {
            const listed = mcpClient.getServerCapabilities()?.tools
              ? yield* McpCatalogController.defs(mcpClient, mcp.timeout)
              : []
            return {
              mcpClient,
              status,
              defs: listed,
              instructions: mcpClient.getInstructions()?.trim(),
            } satisfies CreateResult
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.tryPromise(() => mcpClient.close()).pipe(
                Effect.ignore,
                Effect.andThen(Effect.failCause(cause)),
              ),
            ),
          )
        },
        Effect.map((result): CreateResult => result),
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
          const error = Cause.squash(cause)
          return Effect.succeed<CreateResult>({
            status: { status: "failed", error: error instanceof Error ? error.message : String(error) },
          })
        }),
      )

      // -----------------------------------------------------------------------
      // Watch helper — wires onclose + notification handlers
      // -----------------------------------------------------------------------

      function watch(name: string, client: MCPClient, timeout?: number) {
        client.onclose = () => {
          if (s.clients[name] !== client) return
          delete s.clients[name]
          delete s.defs[name]
          delete s.instructions[name]
          s.status[name] = { status: "failed", error: "Connection closed" }
          Effect.runFork(
            Effect.logWarning("MCP connection closed", { server: name }).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  mcpCallbacks.onToolsChanged?.(name)
                }),
              ),
              Effect.ignore,
            ),
          )
        }

        client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
          Effect.runFork(serverLog(name, notification.params))
          return Promise.resolve()
        })

        if (!client.getServerCapabilities()?.tools) return
        client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
          if (s.clients[name] !== client || s.status[name]?.status !== "connected") return
          const listed = await Effect.runPromise(McpCatalogController.defs(client, timeout))
          if (s.clients[name] !== client || s.status[name]?.status !== "connected") return
          s.defs[name] = listed
          mcpCallbacks.onToolsChanged?.(name)
        })
      }

      function serverLog(name: string, params: LoggingMessageNotification["params"]) {
        const fields = { server: name, logger: params.logger, level: params.level, data: params.data }
        switch (params.level) {
          case "debug":
            return Effect.logDebug("MCP server log", fields)
          case "info":
          case "notice":
            return Effect.logInfo("MCP server log", fields)
          case "warning":
            return Effect.logWarning("MCP server log", fields)
          case "error":
          case "critical":
          case "alert":
          case "emergency":
            return Effect.logError("MCP server log", fields)
        }
      }

      // -----------------------------------------------------------------------
      // storeClient / closeClient helpers
      // -----------------------------------------------------------------------

      function closeClient(name: string): Effect.Effect<void> {
        const client = s.clients[name]
        delete s.clients[name]
        delete s.defs[name]
        delete s.instructions[name]
        if (!client) return Effect.void
        return Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
      }

      function storeClient(
        name: string,
        client: MCPClient,
        listed: MCPToolDef[],
        instructions: string | undefined,
        timeout?: number,
      ): Effect.Effect<Status> {
        return Effect.gen(function* () {
          const previous = s.clients[name]
          s.status[name] = { status: "connected" }
          s.clients[name] = client
          s.defs[name] = listed
          if (instructions) s.instructions[name] = instructions
          else delete s.instructions[name]
          watch(name, client, timeout)
          if (previous) yield* Effect.tryPromise(() => previous.close()).pipe(Effect.ignore)
          return s.status[name]
        })
      }

      // -----------------------------------------------------------------------
      // createAndStore
      // -----------------------------------------------------------------------

      const createAndStore = Effect.fn("McpController.createAndStore")(function* (
        name: string,
        mcp: McpConfig.Info,
      ) {
        const result = yield* create(name, mcp)
        s.status[name] = result.status
        if (!result.mcpClient) {
          yield* closeClient(name)
          return result.status
        }
        return yield* storeClient(name, result.mcpClient, result.defs!, result.instructions, mcp.timeout)
      })

      // -----------------------------------------------------------------------
      // Config resolution helpers
      // -----------------------------------------------------------------------

      const getMcpConfig = Effect.fnUntraced(function* (mcpName: string) {
        if (s.config[mcpName]) return s.config[mcpName]
        return undefined
      })

      const requireMcpConfig = Effect.fnUntraced(function* (mcpName: string) {
        const mcpConfig = yield* getMcpConfig(mcpName)
        if (!mcpConfig) return yield* new NotFoundError({ name: mcpName })
        return mcpConfig
      })

      function requestTimeout(name: string, fallback?: number) {
        return s.config[name]?.timeout ?? fallback
      }

      // -----------------------------------------------------------------------
      // Public operations
      // -----------------------------------------------------------------------

      const status = Effect.fn("McpController.status")(function* () {
        const result: Record<string, Status> = {}
        for (const key of Object.keys(s.config)) {
          result[key] = s.status[key] ?? { status: "disabled" }
        }
        return result
      })

      const clients = Effect.fn("McpController.clients")(function* () {
        return s.clients
      })

      const instructions = Effect.fn("McpController.instructions")(function* () {
        return Object.entries(s.instructions)
          .filter(([name]) => s.status[name]?.status === "connected")
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, item]) => ({
            name,
            instructions: item,
            tools: (s.defs[name] ?? []).map((tool) => McpCatalogController.toolName(name, tool.name)),
          }))
      })

      const tools = Effect.fn("McpController.tools")(function* () {
        const result: Record<string, McpTool> = {}
        for (const [clientName, client] of Object.entries(s.clients)) {
          if (s.status[clientName]?.status !== "connected") continue
          const listed = s.defs[clientName]
          if (!listed) {
            yield* Effect.logWarning("missing cached tools for connected server", { clientName })
            continue
          }
          const timeout = requestTimeout(clientName)
          for (const def of listed) {
            result[McpCatalogController.toolName(clientName, def.name)] = { def, client, timeout }
          }
        }
        return result
      })

      function collectFromConnected<T extends { name: string }>(
        listFn: (c: Client, timeout?: number) => Promise<T[]>,
        label: string,
        key?: (item: T) => string,
        targetClientName?: string,
      ) {
        return Effect.gen(function* () {
          return yield* Effect.forEach(
            Object.entries(s.clients).filter(
              ([name]) =>
                s.status[name]?.status === "connected" && (!targetClientName || name === targetClientName),
            ),
            ([clientName, client]) =>
              McpCatalogController.fetch(
                clientName,
                client,
                (c) => listFn(c, requestTimeout(clientName)),
                label,
                key,
              ).pipe(Effect.map((items) => Object.entries(items ?? {}))),
            { concurrency: "unbounded" },
          ).pipe(Effect.map((results) => Object.fromEntries<T & { client: string }>(results.flat())))
        })
      }

      const prompts = Effect.fn("McpController.prompts")(function* () {
        return yield* collectFromConnected(McpCatalogController.prompts, "prompts")
      })

      const resources = Effect.fn("McpController.resources")(function* (clientName?: string) {
        return yield* collectFromConnected(
          McpCatalogController.resources,
          "resources",
          (resource) => resource.uri,
          clientName,
        )
      })

      const resourceTemplates = Effect.fn("McpController.resourceTemplates")(function* (clientName?: string) {
        return yield* collectFromConnected(
          McpCatalogController.resourceTemplates,
          "resource templates",
          (template) => template.uriTemplate,
          clientName,
        )
      })

      const withClient = Effect.fnUntraced(function* <A>(
        clientName: string,
        fn: (client: MCPClient, timeout?: number) => Promise<A>,
        label: string,
        meta?: Record<string, unknown>,
      ) {
        const client = s.clients[clientName]
        if (!client) {
          yield* Effect.logWarning(`client not found for ${label}`, { clientName })
          return undefined
        }
        return yield* Effect.tryPromise({
          try: () => fn(client, requestTimeout(clientName)),
          catch: (error) => error,
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError(`failed to ${label}`, {
              clientName,
              ...meta,
              error: error instanceof Error ? error.message : String(error),
            }),
          ),
          Effect.orElseSucceed(() => undefined),
        )
      })

      const getPrompt = Effect.fn("McpController.getPrompt")(function* (
        clientName: string,
        name: string,
        args?: Record<string, string>,
      ) {
        return yield* withClient(
          clientName,
          (client, timeout) => client.getPrompt({ name, arguments: args }, { timeout }),
          "getPrompt",
          { promptName: name },
        )
      })

      const readResource = Effect.fn("McpController.readResource")(function* (
        clientName: string,
        resourceUri: string,
      ) {
        return yield* withClient(
          clientName,
          (client, timeout) => client.readResource({ uri: resourceUri }, { timeout }),
          "readResource",
          { resourceUri },
        )
      })

      const config = Effect.fn("McpController.config")(function* () {
        return { ...s.config }
      })

      const serverDefs = Effect.fn("McpController.serverDefs")(function* () {
        const result: Record<string, string[]> = {}
        for (const [name, defs] of Object.entries(s.defs)) {
          result[name] = defs.map((d) => d.name)
        }
        return result
      })

      const add = Effect.fn("McpController.add")(function* (name: string, mcp: McpConfig.Info) {
        s.config[name] = mcp
        yield* createAndStore(name, mcp)
        return { status: s.status }
      })

      const connect = Effect.fn("McpController.connect")(function* (name: string) {
        const mcp = yield* requireMcpConfig(name)
        yield* createAndStore(name, { ...mcp, enabled: true })
      })

      const disconnect = Effect.fn("McpController.disconnect")(function* (name: string) {
        yield* requireMcpConfig(name)
        yield* closeClient(name)
        s.status[name] = { status: "disabled" }
      })

      /** Fully purge a server's in-memory state (used by the /mcp DELETE flow). */
      const remove = Effect.fn("McpController.remove")(function* (name: string) {
        if (!s.config[name]) return
        yield* closeClient(name).pipe(Effect.ignore)
        delete s.config[name]
        delete s.status[name]
        delete s.defs[name]
        delete s.instructions[name]
        delete s.clients[name]
      })

      // -----------------------------------------------------------------------
      // OAuth / auth operations
      // -----------------------------------------------------------------------

      const startAuth = Effect.fn("McpController.startAuth")(function* (mcpName: string) {
        const mcpConfig = yield* requireMcpConfig(mcpName)
        if (mcpConfig.type !== "remote")
          throw new Error(`MCP server ${mcpName} is not a remote server`)
        if (mcpConfig.oauth === false)
          throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)
        const url = remoteURL(mcpConfig.url)
        if (!url) throw new Error(`Invalid MCP URL for "${mcpName}"`)

        const oauthConfig = typeof mcpConfig.oauth === "object" ? (mcpConfig.oauth as McpOAuthConfig) : undefined

        const effectiveRedirectUri =
          oauthConfig?.redirectUri ??
          (oauthConfig?.callbackPort
            ? `http://127.0.0.1:${oauthConfig.callbackPort}${OAUTH_CALLBACK_PATH}`
            : undefined)

        yield* Effect.promise(() => McpOAuthCallback.ensureRunning(effectiveRedirectUri))

        const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
        yield* auth.updateOAuthState(mcpName, oauthState)

        let capturedUrl: URL | undefined
        const authProvider = new McpOAuthPendingProvider(
          mcpName,
          mcpConfig.url,
          {
            clientId: oauthConfig?.clientId,
            clientSecret: oauthConfig?.clientSecret,
            scope: oauthConfig?.scope,
            redirectUri: effectiveRedirectUri,
          },
          {
            onRedirect: async (url) => {
              capturedUrl = url
            },
          },
          auth,
        )

        const transport = new StreamableHTTPClientTransport(url, {
          authProvider,
          requestInit: mcpConfig.headers ? { headers: mcpConfig.headers as Record<string, string> } : undefined,
        })

        return yield* Effect.tryPromise({
          try: () => {
            const client = createClient(workingDirectory)
            return client.connect(transport).then(async () => {
              await authProvider.commit()
              return { authorizationUrl: "", oauthState, client } satisfies AuthResult
            })
          },
          catch: (error) => error,
        }).pipe(
          Effect.catch((error) => {
            if (error instanceof UnauthorizedError && capturedUrl) {
              pendingOAuthTransports.set(mcpName, { transport, provider: authProvider })
              return Effect.succeed({
                authorizationUrl: capturedUrl.toString(),
                oauthState,
              } satisfies AuthResult)
            }
            return Effect.die(error)
          }),
        )
      })

      const authenticate = Effect.fn("McpController.authenticate")(function* (
        mcpName: string,
        onAuthorization?: (authorizationUrl: string) => void,
      ) {
        const result = yield* startAuth(mcpName)
        if (!result.authorizationUrl) {
          const client = "client" in result ? (result as AuthResult).client : undefined
          const mcpConfig = yield* requireMcpConfig(mcpName).pipe(
            Effect.tapError(() =>
              Effect.tryPromise(() => client?.close() ?? Promise.resolve()).pipe(Effect.ignore),
            ),
          )

          const listed = client
            ? client.getServerCapabilities()?.tools
              ? yield* McpCatalogController.defs(client, mcpConfig.timeout)
              : []
            : undefined
          if (!client || !listed) {
            yield* Effect.tryPromise(() => client?.close() ?? Promise.resolve()).pipe(Effect.ignore)
            return { status: "failed", error: "Failed to get tools" } satisfies Status
          }

          yield* auth.clearOAuthState(mcpName)
          return yield* storeClient(mcpName, client, listed, client.getInstructions()?.trim(), mcpConfig.timeout)
        }

        const callbackPromise = McpOAuthCallback.waitForCallback(result.oauthState, mcpName)
        onAuthorization?.(result.authorizationUrl)

        yield* Effect.tryPromise(() => open(result.authorizationUrl)).pipe(
          Effect.flatMap((subprocess) =>
            Effect.callback<void, Error>((resume) => {
              const timer = setTimeout(() => resume(Effect.void), 500)
              subprocess.on("error", (err: Error) => {
                clearTimeout(timer)
                resume(Effect.fail(err))
              })
              subprocess.on("exit", (code: number | null) => {
                if (code !== null && code !== 0) {
                  clearTimeout(timer)
                  resume(Effect.fail(new Error(`Browser open failed with exit code ${code}`)))
                }
              })
            }),
          ),
          Effect.catch(() => {
            mcpCallbacks.onBrowserOpenFailed?.(mcpName, result.authorizationUrl)
            return Effect.void
          }),
        )

        const code = yield* Effect.promise(() => callbackPromise)

        const storedState = yield* auth.getOAuthState(mcpName)
        if (storedState !== result.oauthState) {
          yield* auth.clearOAuthState(mcpName)
          throw new Error("OAuth state mismatch - potential CSRF attack")
        }
        yield* auth.clearOAuthState(mcpName)
        return yield* finishAuth(mcpName, code)
      })

      const finishAuth = Effect.fn("McpController.finishAuth")(function* (
        mcpName: string,
        authorizationCode: string,
      ) {
        yield* requireMcpConfig(mcpName)
        const pending = pendingOAuthTransports.get(mcpName)
        if (!pending) throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)

        const error = yield* Effect.tryPromise({
          try: () => pending.transport.finishAuth(authorizationCode),
          catch: (error) => error,
        }).pipe(
          Effect.match({
            onFailure: (error) => (error instanceof Error ? error.message : String(error)),
            onSuccess: () => undefined,
          }),
        )

        if (error) return { status: "failed", error: `OAuth completion failed: ${error}` } satisfies Status

        yield* Effect.promise(() => pending.provider?.commit() ?? Promise.resolve())
        yield* auth.clearCodeVerifier(mcpName)
        pendingOAuthTransports.delete(mcpName)

        const mcpConfig = yield* requireMcpConfig(mcpName)
        return yield* createAndStore(mcpName, { ...mcpConfig, enabled: true })
      })

      const removeAuth = Effect.fn("McpController.removeAuth")(function* (mcpName: string) {
        yield* auth.remove(mcpName)
        McpOAuthCallback.cancelPending(mcpName)
        pendingOAuthTransports.delete(mcpName)
      })

      const supportsOAuth = Effect.fn("McpController.supportsOAuth")(function* (mcpName: string) {
        const mcpConfig = yield* requireMcpConfig(mcpName)
        return mcpConfig.type === "remote" && mcpConfig.oauth !== false
      })

      const hasStoredTokens = Effect.fn("McpController.hasStoredTokens")(function* (mcpName: string) {
        const entry = yield* auth.get(mcpName)
        return !!entry?.tokens
      })

      const getAuthStatus = Effect.fn("McpController.getAuthStatus")(function* (mcpName: string) {
        const mcpConfig = s.config[mcpName]
        if (!mcpConfig || !isMcpConfigured(mcpConfig) || mcpConfig.type !== "remote")
          return "not_authenticated" as AuthStatus
        const entry = yield* auth.getForUrl(mcpName, mcpConfig.url)
        if (!entry?.tokens) return "not_authenticated" as AuthStatus
        if (entry.tokens.expiresAt && entry.tokens.expiresAt < Date.now() / 1000) return "expired" as AuthStatus
        return "authenticated" as AuthStatus
      })

      // -----------------------------------------------------------------------
      // loadConfig — bulk-load from neko.json (or equivalent)
      // -----------------------------------------------------------------------

      const loadConfig = Effect.fn("McpController.loadConfig")(function* (
        configs: Record<string, McpConfig.Info>,
        directory: string,
        options?: { defaultTimeout?: number },
      ) {
        workingDirectory = directory

        yield* Effect.forEach(
          Object.entries(configs),
          ([key, mcp]) =>
            Effect.gen(function* () {
              if (!isMcpConfigured(mcp)) {
                yield* Effect.logError("Ignoring MCP config entry without type", { key })
                return
              }
              if (mcp.enabled === false) {
                s.status[key] = { status: "disabled" }
                s.config[key] = mcp
                return
              }
              s.config[key] = mcp
              const result = yield* create(key, mcp)
              s.status[key] = result.status
              if (result.mcpClient) {
                s.clients[key] = result.mcpClient
                s.defs[key] = result.defs!
                if (result.instructions) s.instructions[key] = result.instructions
                watch(key, result.mcpClient, mcp.timeout ?? options?.defaultTimeout)
              }
            }),
          { concurrency: "unbounded" },
        )
      })

      return Service.of({
        status,
        clients,
        instructions,
        tools,
        prompts,
        resources,
        resourceTemplates,
        config,
        serverDefs,
        add,
        connect,
        disconnect,
        remove,
        getPrompt,
        readResource,
        startAuth,
        authenticate,
        finishAuth,
        removeAuth,
        supportsOAuth,
        hasStoredTokens,
        getAuthStatus,
        loadConfig,
      })
    }),
  )
}

/** Default layer — uses McpAuthController.Service from context, no initial config. */
export const layer = (directory: string, callbacks?: McpControllerCallbacks) =>
  makeLayer(directory, callbacks)
