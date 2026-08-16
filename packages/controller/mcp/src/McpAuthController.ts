/**
 * McpAuthController — manages OAuth tokens and client credentials for MCP servers.
 *
 * Ported from packages/neko/src/mcp/auth.ts.
 * Stores auth data in a local JSON file inside the XDG data directory.
 */
export * as McpAuthController from "./McpAuthController"

import path from "path"
import fs from "fs/promises"
import os from "os"
import { xdgData } from "xdg-basedir"
import { Context, Effect, Layer, Option, Schema } from "effect"

// ---------------------------------------------------------------------------
// Data dir helper (replaces @neko/core/global)
// ---------------------------------------------------------------------------

function dataDir(): string {
  return path.join(xdgData ?? path.join(os.homedir(), ".local", "share"), "neko")
}

// ---------------------------------------------------------------------------
// Schema definitions
// (Schema.mutableKey is a v4 API; in v3 we use plain Schema.optional)
// ---------------------------------------------------------------------------

export const Tokens = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.Number),
  scope: Schema.optional(Schema.String),
})
export type Tokens = Schema.Schema.Type<typeof Tokens>

export const ClientInfo = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.optional(Schema.String),
  clientIdIssuedAt: Schema.optional(Schema.Number),
  clientSecretExpiresAt: Schema.optional(Schema.Number),
})
export type ClientInfo = Schema.Schema.Type<typeof ClientInfo>

export const Entry = Schema.Struct({
  tokens: Schema.optional(Tokens),
  clientInfo: Schema.optional(ClientInfo),
  codeVerifier: Schema.optional(Schema.String),
  oauthState: Schema.optional(Schema.String),
  serverUrl: Schema.optional(Schema.String),
})
export type Entry = Schema.Schema.Type<typeof Entry>

const decodeAuthData = Schema.decodeUnknownOption(Schema.Record(Schema.String, Entry) as Schema.Decoder<AuthData>)
type AuthData = Record<string, Entry>

// ---------------------------------------------------------------------------
// File locking (simple in-memory mutex — adequate for a single process)
// ---------------------------------------------------------------------------

class InProcessLock {
  private queue: Array<() => void> = []
  private held = false

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this.held) {
          this.held = true
          resolve(() => {
            this.held = false
            const next = this.queue.shift()
            if (next) next()
          })
        } else {
          this.queue.push(tryAcquire)
        }
      }
      tryAcquire()
    })
  }
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface Interface {
  readonly all: () => Effect.Effect<Record<string, Entry>>
  readonly get: (mcpName: string) => Effect.Effect<Entry | undefined>
  readonly getForUrl: (mcpName: string, serverUrl: string) => Effect.Effect<Entry | undefined>
  readonly set: (mcpName: string, entry: Entry, serverUrl?: string) => Effect.Effect<void>
  readonly remove: (mcpName: string) => Effect.Effect<void>
  readonly updateTokens: (mcpName: string, tokens: Tokens, serverUrl?: string) => Effect.Effect<void>
  readonly updateClientInfo: (mcpName: string, clientInfo: ClientInfo, serverUrl?: string) => Effect.Effect<void>
  readonly updateCodeVerifier: (mcpName: string, codeVerifier: string) => Effect.Effect<void>
  readonly clearCodeVerifier: (mcpName: string) => Effect.Effect<void>
  readonly updateOAuthState: (mcpName: string, oauthState: string) => Effect.Effect<void>
  readonly getOAuthState: (mcpName: string) => Effect.Effect<string | undefined>
  readonly clearOAuthState: (mcpName: string) => Effect.Effect<void>
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class Service extends Context.Service<Service, Interface>()("@gco/McpAuthController") {}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const dataPath = dataDir()
    const filepath = path.join(dataPath, "mcp-auth.json")
    const lock = new InProcessLock()

    // Ensure data directory exists
    yield* Effect.tryPromise(() => fs.mkdir(dataPath, { recursive: true })).pipe(Effect.ignore)

    const read = Effect.fn("McpAuthController.read")(function* (): Effect.fn.Return<AuthData> {
      return yield* Effect.tryPromise({
        try: async () => {
          try {
            const raw = await fs.readFile(filepath, "utf8")
            const parsed = JSON.parse(raw)
            return Option.getOrElse(decodeAuthData(parsed), () => ({}) as AuthData) as AuthData
          } catch {
            return {} as AuthData
          }
        },
        catch: () => {},
      }).pipe(Effect.orElseSucceed(() => ({}) as AuthData))
    })

    const writeRaw = (data: AuthData) =>
      Effect.tryPromise({
        try: () => fs.writeFile(filepath, JSON.stringify(data, null, 2), { mode: 0o600 }),
        catch: (e) => e,
      })

    const all = Effect.fn("McpAuthController.all")(function* () {
      return yield* read()
    })

    const mutate = Effect.fn("McpAuthController.mutate")(function* (
      update: (data: AuthData) => AuthData | undefined,
    ) {
      const release = yield* Effect.promise(() => lock.acquire())
      try {
        const next = update(yield* read())
        if (!next) return
        yield* writeRaw(next).pipe(Effect.orDie)
      } finally {
        release()
      }
    })

    const get = Effect.fn("McpAuthController.get")(function* (mcpName: string) {
      const data = yield* all()
      return data[mcpName]
    })

    const getForUrl = Effect.fn("McpAuthController.getForUrl")(function* (
      mcpName: string,
      serverUrl: string,
    ) {
      const entry = yield* get(mcpName)
      if (!entry) return undefined
      if (!entry.serverUrl) return undefined
      if (entry.serverUrl !== serverUrl) return undefined
      return entry
    })

    const set = Effect.fn("McpAuthController.set")(function* (
      mcpName: string,
      entry: Entry,
      serverUrl?: string,
    ) {
      yield* mutate((data) => ({
        ...data,
        [mcpName]: serverUrl ? { ...entry, serverUrl } : entry,
      }))
    })

    const remove = Effect.fn("McpAuthController.remove")(function* (mcpName: string) {
      yield* mutate((data) => {
        const next = { ...data }
        delete next[mcpName]
        return next
      })
    })

    const updateTokens = Effect.fn("McpAuthController.updateTokens")(function* (
      mcpName: string,
      tokens: Tokens,
      serverUrl?: string,
    ) {
      yield* mutate((data) => {
        const entry = (data[mcpName] ?? {}) as Entry
        const updated: Entry = { ...entry, tokens, ...(serverUrl ? { serverUrl } : {}) }
        return { ...data, [mcpName]: updated }
      })
    })

    const updateClientInfo = Effect.fn("McpAuthController.updateClientInfo")(function* (
      mcpName: string,
      clientInfo: ClientInfo,
      serverUrl?: string,
    ) {
      yield* mutate((data) => {
        const entry = (data[mcpName] ?? {}) as Entry
        const updated: Entry = { ...entry, clientInfo, ...(serverUrl ? { serverUrl } : {}) }
        return { ...data, [mcpName]: updated }
      })
    })

    const updateCodeVerifier = Effect.fn("McpAuthController.updateCodeVerifier")(function* (
      mcpName: string,
      codeVerifier: string,
    ) {
      yield* mutate((data) => {
        const entry = (data[mcpName] ?? {}) as Entry
        return { ...data, [mcpName]: { ...entry, codeVerifier } }
      })
    })

    const clearCodeVerifier = Effect.fn("McpAuthController.clearCodeVerifier")(function* (
      mcpName: string,
    ) {
      yield* mutate((data) => {
        const entry = data[mcpName]
        if (!entry) return undefined
        const { codeVerifier: _omit, ...rest } = entry
        return { ...data, [mcpName]: rest }
      })
    })

    const updateOAuthState = Effect.fn("McpAuthController.updateOAuthState")(function* (
      mcpName: string,
      oauthState: string,
    ) {
      yield* mutate((data) => {
        const entry = (data[mcpName] ?? {}) as Entry
        return { ...data, [mcpName]: { ...entry, oauthState } }
      })
    })

    const clearOAuthState = Effect.fn("McpAuthController.clearOAuthState")(function* (
      mcpName: string,
    ) {
      yield* mutate((data) => {
        const entry = data[mcpName]
        if (!entry) return undefined
        const { oauthState: _omit, ...rest } = entry
        return { ...data, [mcpName]: rest }
      })
    })

    const getOAuthState = Effect.fn("McpAuthController.getOAuthState")(function* (mcpName: string) {
      const entry = yield* get(mcpName)
      return entry?.oauthState
    })

    return Service.of({
      all,
      get,
      getForUrl,
      set,
      remove,
      updateTokens,
      updateClientInfo,
      updateCodeVerifier,
      clearCodeVerifier,
      updateOAuthState,
      getOAuthState,
      clearOAuthState,
    })
  }),
)

export { layer }
