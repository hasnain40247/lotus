/**
 * McpWebsearchTool — web search via a registered MCP server.
 *
 * Unlike WebSearchTool (which calls Exa/Parallel directly), this tool routes
 * search requests through the MCP catalog, using whichever MCP server exposes
 * a web_search capability. The caller wires the concrete MCP client via the
 * IMcpWebsearchService context.
 */
export * as McpWebsearchTool from "./McpWebsearchTool"

import { Context, Effect, Schema } from "effect"
import { ToolFailure, make as makeTool, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "mcp_websearch"
export const NO_RESULTS = "No search results found. Please try a different query."
export const MAX_NUM_RESULTS = 20

export const description = `Search the web via a connected MCP server that exposes a web_search tool.

Use this for current information beyond the model's knowledge cutoff. Results are
returned as-is from the MCP server. Specify an optional client name to route to a
specific MCP server; otherwise the first available web-search-capable server is used.

The current year is ${new Date().getFullYear()}. Use this year when searching for recent information or current events.`

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const Input = Schema.Struct({
  query: Schema.String.annotate({ description: "Web search query" }),
  numResults: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_NUM_RESULTS))).annotate({
    description: `Maximum number of results (default: 8, maximum: ${MAX_NUM_RESULTS})`,
  }),
  client: Schema.optional(Schema.String).annotate({
    description: "MCP client name to route the search through. Omit to auto-select.",
  }),
})

export const Output = Schema.Struct({
  query: Schema.String,
  client: Schema.String,
  text: Schema.String,
})
export type Output = typeof Output.Type

// ---------------------------------------------------------------------------
// MCP web search service interface
// ---------------------------------------------------------------------------

export interface McpWebsearchInput {
  readonly query: string
  readonly numResults?: number
  readonly client?: string
  readonly sessionID: string
}

export interface McpWebsearchResult {
  readonly client: string
  readonly text: string
}

export interface IMcpWebsearchService {
  readonly search: (input: McpWebsearchInput) => Effect.Effect<McpWebsearchResult, Error>
}

export class McpWebsearchService extends Context.Service<McpWebsearchService, IMcpWebsearchService>()(
  "@gco/McpWebsearchService",
) {}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export const makeMcpWebsearchTool = (service: IMcpWebsearchService): AnyTool =>
  makeTool({
    description,
    input: Input,
    output: Output,
    toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
    execute: (input, context) =>
      service
        .search({
          query: input.query,
          numResults: input.numResults,
          client: input.client,
          sessionID: context.sessionID,
        })
        .pipe(
          Effect.mapError(
            (e) => new ToolFailure({ message: `MCP web search failed: ${e.message}` }),
          ),
          Effect.map((result) => ({
            query: input.query,
            client: result.client,
            text: result.text || NO_RESULTS,
          })),
        ),
  })

/** Effect that builds the McpWebsearchTool using the injected McpWebsearchService. */
export const makeToolEffect: Effect.Effect<AnyTool, never, McpWebsearchService> = Effect.gen(function* () {
  const svc = yield* McpWebsearchService
  return makeMcpWebsearchTool(svc)
})
