/**
 * WebSearchTool — web search via Exa or Parallel AI backends.
 *
 * Ported from @neko/core tool/websearch.ts.
 * Logic kept identical.
 */
export * as WebSearchTool from "./WebSearchTool"

import { Context, Effect, Layer, Schema } from "effect"
import { ToolFailure, make as makeTool, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "websearch"
export const NO_RESULTS = "No search results found. Please try a different query."
export const EXA_URL = "https://mcp.exa.ai/mcp"
export const PARALLEL_URL = "https://search.parallel.ai/mcp"
export const MAX_NUM_RESULTS = 20
export const MAX_CONTEXT_CHARACTERS = 50_000
export const MAX_RESPONSE_BYTES = 256 * 1024

export const description = `Search the web using the session's local web search provider. Use this for current information beyond knowledge cutoff.

This is a provider-independent local tool backed by Exa or Parallel. Provider-hosted web search tools are separate and execute at the model provider.

Optional controls support result count, live crawling ('fallback' or 'preferred'), search type ('auto', 'fast', or 'deep'), and maximum context characters.

The current year is ${new Date().getFullYear()}. Use this year when searching for recent information or current events.`

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const Input = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  numResults: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_NUM_RESULTS))).annotate({
    description: `Number of search results to return (default: 8, maximum: ${MAX_NUM_RESULTS})`,
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description:
      "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
  }),
  contextMaxCharacters: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_CONTEXT_CHARACTERS)),
  ).annotate({
    description: `Maximum characters for context string optimized for models (default: 10000, maximum: ${MAX_CONTEXT_CHARACTERS})`,
  }),
})

export const Provider = Schema.Literals(["exa", "parallel"])
export type Provider = typeof Provider.Type

export interface WebSearchConfig {
  readonly provider?: Provider
  readonly enableExa: boolean
  readonly enableParallel: boolean
  readonly exaApiKey?: string
  readonly parallelApiKey?: string
}

export class ConfigService extends Context.Service<ConfigService, WebSearchConfig>()("@gco/WebSearchConfig") {}

export const defaultConfigLayer = Layer.sync(ConfigService, () =>
  ConfigService.of({
    provider:
      process.env.NEKO_WEBSEARCH_PROVIDER === "exa" || process.env.NEKO_WEBSEARCH_PROVIDER === "parallel"
        ? (process.env.NEKO_WEBSEARCH_PROVIDER as Provider)
        : undefined,
    enableExa:
      process.env.NEKO_EXPERIMENTAL === "true" ||
      process.env.NEKO_ENABLE_EXA === "true" ||
      process.env.NEKO_EXPERIMENTAL_EXA === "true",
    enableParallel:
      process.env.NEKO_ENABLE_PARALLEL === "true" ||
      process.env.NEKO_EXPERIMENTAL_PARALLEL === "true",
    exaApiKey: process.env.EXA_API_KEY,
    parallelApiKey: process.env.PARALLEL_API_KEY,
  }),
)

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

function checksum(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

export function selectProvider(
  sessionID: string,
  flags: Pick<WebSearchConfig, "enableExa" | "enableParallel"> = { enableExa: false, enableParallel: false },
  override?: Provider,
): Provider {
  if (override) return override
  if (flags.enableParallel) return "parallel"
  if (flags.enableExa) return "exa"
  return Number.parseInt(checksum(sessionID) ?? "0", 36) % 2 === 0 ? "exa" : "parallel"
}

// ---------------------------------------------------------------------------
// MCP HTTP helpers
// ---------------------------------------------------------------------------

const McpResult = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String })),
  }),
})

const parsePayload = (payload: string): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const trimmed = payload.trim()
    if (!trimmed.startsWith("{")) return undefined
    const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(McpResult))(trimmed).pipe(
      Effect.catchCause(() => Effect.succeed(undefined as any)),
    )
    return (decoded as any)?.result?.content?.find((item: { text?: string }) => item.text)?.text
  })

export const parseResponse = (body: string): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const trimmed = body.trim()
    const direct = trimmed ? yield* parsePayload(trimmed) : undefined
    if (direct) return direct
    for (const line of body.split("\n")) {
      if (!line.startsWith("data: ")) continue
      const data = yield* parsePayload(line.substring(6))
      if (data) return data
    }
    return undefined
  })

async function collectBoundedFetch(url: string, options: RequestInit, maxBytes: number): Promise<Buffer> {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = response.body?.getReader()
  if (!reader) throw new Error("No response body")
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) throw new Error("Response exceeded limit")
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

function exaUrl(apiKey: string | undefined): string {
  if (!apiKey) return EXA_URL
  const url = new URL(EXA_URL)
  url.searchParams.set("exaApiKey", apiKey)
  return url.toString()
}

const callExaMcp = (
  url: string,
  args: {
    query: string
    type: string
    numResults: number
    livecrawl: string
    contextMaxCharacters?: number
  },
): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search_exa", arguments: args },
    })
    const raw = yield* Effect.promise(() =>
      collectBoundedFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body,
        signal: AbortSignal.timeout(25_000),
      }, MAX_RESPONSE_BYTES),
    )
    return yield* parseResponse(raw.toString("utf8"))
  })

const callParallelMcp = (
  args: { objective: string; search_queries: string[]; session_id: string },
  parallelApiKey?: string,
): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search", arguments: args },
    })
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    }
    if (parallelApiKey) headers["Authorization"] = `Bearer ${parallelApiKey}`
    const raw = yield* Effect.promise(() =>
      collectBoundedFetch(PARALLEL_URL, { method: "POST", headers, body, signal: AbortSignal.timeout(25_000) }, MAX_RESPONSE_BYTES),
    )
    return yield* parseResponse(raw.toString("utf8"))
  })

const Output = Schema.Struct({
  provider: Provider,
  text: Schema.String,
})

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const makeWebSearchTool = (config: WebSearchConfig): AnyTool =>
  makeTool({
    description,
    input: Input,
    output: Output,
    toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
    execute: (input, context) => {
      const provider = selectProvider(context.sessionID, config, config.provider)
      return Effect.gen(function* () {
        const text =
          provider === "exa"
            ? yield* callExaMcp(exaUrl(config.exaApiKey), {
                query: input.query,
                type: input.type || "auto",
                numResults: input.numResults || 8,
                livecrawl: input.livecrawl || "fallback",
                contextMaxCharacters: input.contextMaxCharacters,
              })
            : yield* callParallelMcp(
                {
                  objective: input.query,
                  search_queries: [input.query],
                  session_id: context.sessionID,
                },
                config.parallelApiKey,
              )
        return { provider, text: text ?? NO_RESULTS }
      }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to search the web for ${input.query}` })))
    },
  })

/** Default tool instance (uses env-var-based config). */
export const tool: AnyTool = makeWebSearchTool({
  provider:
    process.env.NEKO_WEBSEARCH_PROVIDER === "exa" || process.env.NEKO_WEBSEARCH_PROVIDER === "parallel"
      ? (process.env.NEKO_WEBSEARCH_PROVIDER as Provider)
      : undefined,
  enableExa: process.env.NEKO_EXPERIMENTAL === "true" || process.env.NEKO_ENABLE_EXA === "true",
  enableParallel: process.env.NEKO_ENABLE_PARALLEL === "true",
  exaApiKey: process.env.EXA_API_KEY,
  parallelApiKey: process.env.PARALLEL_API_KEY,
})
