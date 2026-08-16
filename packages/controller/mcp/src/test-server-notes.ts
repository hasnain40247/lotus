/**
 * test-server-notes.ts — second standalone stdio MCP server for testing.
 *
 * Exposes an in-memory key/value note store so tests can exercise stateful
 * behavior across tool calls against a single server instance.
 *
 *   note_set    — set a note by key
 *   note_get    — get a note by key
 *   note_list   — list all note keys
 *   note_delete — delete a note by key
 *
 * Run directly:
 *   bun packages/controller/mcp/src/test-server-notes.ts
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

const notes = new Map<string, string>()

const TOOLS = [
  {
    name: "note_set",
    description: "Store a note under a key. Overwrites any existing value for that key.",
    inputSchema: {
      type: "object" as const,
      properties: {
        key: { type: "string", description: "Key to store the note under" },
        value: { type: "string", description: "The note contents" },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "note_get",
    description: "Retrieve a note by its key. Returns an error message if not found.",
    inputSchema: {
      type: "object" as const,
      properties: {
        key: { type: "string", description: "Key to look up" },
      },
      required: ["key"],
    },
  },
  {
    name: "note_list",
    description: "List every stored note key. Returns a newline-separated list.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "note_delete",
    description: "Delete the note stored under a given key.",
    inputSchema: {
      type: "object" as const,
      properties: {
        key: { type: "string", description: "Key to delete" },
      },
      required: ["key"],
    },
  },
]

const server = new Server(
  { name: "neko-test-notes-server", version: "0.1.0" },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, (request) => {
  const { name, arguments: args } = request.params
  const input = (args ?? {}) as Record<string, unknown>

  switch (name) {
    case "note_set": {
      const key = typeof input.key === "string" ? input.key : ""
      const value = typeof input.value === "string" ? input.value : ""
      if (!key) {
        return { content: [{ type: "text" as const, text: "Error: key is required" }], isError: true }
      }
      notes.set(key, value)
      return { content: [{ type: "text" as const, text: `stored "${key}"` }] }
    }

    case "note_get": {
      const key = typeof input.key === "string" ? input.key : ""
      const value = notes.get(key)
      if (value === undefined) {
        return { content: [{ type: "text" as const, text: `Error: no note under "${key}"` }], isError: true }
      }
      return { content: [{ type: "text" as const, text: value }] }
    }

    case "note_list": {
      const keys = [...notes.keys()].sort()
      return { content: [{ type: "text" as const, text: keys.join("\n") }] }
    }

    case "note_delete": {
      const key = typeof input.key === "string" ? input.key : ""
      const removed = notes.delete(key)
      return { content: [{ type: "text" as const, text: removed ? `deleted "${key}"` : `no such key "${key}"` }] }
    }

    default:
      return { content: [{ type: "text" as const, text: `Unknown tool: ${name}` }], isError: true }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
