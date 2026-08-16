/**
 * McpCatalogController — tool/prompt/resource discovery helpers for MCP clients.
 *
 * Ported from packages/neko/src/mcp/catalog.ts.
 * Handles paginated listing of tools, prompts, and resources, plus the
 * canonical tool-name sanitization and conversion utilities.
 */
export * as McpCatalogController from "./McpCatalogController"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  ToolSchema,
  type Tool as MCPToolDef,
} from "@modelcontextprotocol/sdk/types.js"
import { Effect } from "effect"

const DEFAULT_TIMEOUT = 30_000
const MAX_LIST_PAGES = 1_000

// Tolerant schema that ignores the `outputSchema` field some MCP servers send,
// which can confuse the strict SDK parser.
const TolerantListToolsResultSchema = ListToolsResultSchema.extend({
  tools: ToolSchema.omit({ outputSchema: true }).array(),
})

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export async function paginate<T, R extends { nextCursor?: string }>(
  list: (cursor?: string) => Promise<R>,
  items: (result: R) => T[],
): Promise<T[]> {
  const result: T[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const pageResult = await list(cursor)
    result.push(...items(pageResult))
    if (pageResult.nextCursor === undefined) return result
    if (cursors.has(pageResult.nextCursor))
      throw new Error(`MCP list returned duplicate cursor: ${pageResult.nextCursor}`)
    cursors.add(pageResult.nextCursor)
    cursor = pageResult.nextCursor
  }

  throw new Error(`MCP list exceeded ${MAX_LIST_PAGES} pages`)
}

// ---------------------------------------------------------------------------
// Tool listing
// ---------------------------------------------------------------------------

function listTools(client: Client, timeout: number) {
  return Effect.tryPromise({
    try: () =>
      paginate(
        async (cursor) => {
          const params = cursor === undefined ? undefined : { cursor }
          try {
            return await client.listTools(params, { timeout })
          } catch (error) {
            if (!(error instanceof Error) || !isOutputSchemaValidationError(error)) throw error
            return client.request({ method: "tools/list", params }, TolerantListToolsResultSchema, { timeout })
          }
        },
        (result) => result.tools,
      ),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

function isOutputSchemaValidationError(error: Error) {
  return /can't resolve reference|resolves to more than one schema|outputSchema|schema.*reference|reference.*schema/i.test(
    error.message,
  )
}

/**
 * Fetch all tool definitions from a connected client.
 * Returns an empty array (not a failure) if listing fails.
 */
export function defs(client: Client, timeout?: number): Effect.Effect<MCPToolDef[]> {
  return listTools(client, timeout ?? DEFAULT_TIMEOUT).pipe(
    Effect.catch(() => Effect.succeed([] as MCPToolDef[])),
  )
}

// ---------------------------------------------------------------------------
// Generic paginated fetch helper
// ---------------------------------------------------------------------------

/**
 * Fetch a collection from a connected client and index it by sanitized name.
 * Returns `undefined` on failure (logged as a warning); callers should treat
 * `undefined` as an empty map.
 */
export function fetch<T extends { name: string }>(
  clientName: string,
  client: Client,
  list: (client: Client) => Promise<T[]>,
  label: string,
  key?: (item: T) => string,
): Effect.Effect<Record<string, T & { client: string }> | undefined> {
  return Effect.tryPromise({
    try: () => list(client),
    catch: (error) => error,
  }).pipe(
    Effect.tapError((error) =>
      Effect.logWarning(`failed to get ${label}`, {
        clientName,
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
    Effect.map((items) => {
      const sanitizedClient = sanitize(clientName)
      // Escape separator and escape marker so `server:uri` keys remain unambiguous.
      const resourceClient = clientName.replaceAll("%", "%25").replaceAll(":", "%3A")
      return Object.fromEntries(
        items.map((item) => [
          key ? resourceClient + ":" + key(item) : sanitizedClient + ":" + sanitize(item.name),
          { ...item, client: clientName },
        ]),
      ) as Record<string, T & { client: string }>
    }),
    Effect.orElseSucceed(() => undefined),
  )
}

// ---------------------------------------------------------------------------
// Sanitization & naming
// ---------------------------------------------------------------------------

/** Replace characters not safe in tool names with underscores. */
export const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")

/** Canonical tool name: `<sanitized-client>_<sanitized-tool>`. */
export const toolName = (clientName: string, name: string) => sanitize(clientName) + "_" + sanitize(name)

// ---------------------------------------------------------------------------
// Prompts / resources / resource templates
// ---------------------------------------------------------------------------

export function prompts(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.prompts) return Promise.resolve([])
  return paginate(
    (cursor) => client.listPrompts(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.prompts,
  )
}

export function resources(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.resources) return Promise.resolve([])
  return paginate(
    (cursor) => client.listResources(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.resources,
  )
}

export function resourceTemplates(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.resources) return Promise.resolve([])
  return paginate(
    (cursor) => client.listResourceTemplates(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.resourceTemplates,
  )
}

// ---------------------------------------------------------------------------
// Tool conversion helper
// ---------------------------------------------------------------------------

export interface McpToolCallResult {
  isError: boolean
  content: Array<{ type: string; text?: string; [key: string]: unknown }>
  structuredContent?: unknown
}

/**
 * Call an MCP tool and return its raw result.
 * Throws on isError=true (maps the text content to an Error message).
 */
export async function callTool(
  client: Client,
  toolName: string,
  args: Record<string, unknown>,
  options?: { timeout?: number; signal?: AbortSignal },
): Promise<McpToolCallResult> {
  const result = await client.callTool(
    { name: toolName, arguments: args || {} },
    CallToolResultSchema,
    {
      resetTimeoutOnProgress: true,
      signal: options?.signal,
      timeout: options?.timeout,
      onprogress: () => {},
    },
  )

  const content = result.content as Array<{ type: string; text?: string; [key: string]: unknown }>
  if (result.isError) {
    throw new Error(
      content
        .flatMap((item) => (item.type === "text" ? [(item as { text: string }).text] : []))
        .filter((text) => text.trim())
        .join("\n\n") || "MCP tool returned an error",
    )
  }

  if (content.length > 0 || result.structuredContent === undefined || result.structuredContent === null) {
    return { ...result, content } as McpToolCallResult
  }

  return {
    ...result,
    content: [{ type: "text", text: JSON.stringify(result.structuredContent) }],
  } as McpToolCallResult
}
