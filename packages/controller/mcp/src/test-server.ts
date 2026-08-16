/**
 * test-server.ts — standalone stdio MCP server for development / testing.
 *
 * Exposes four simple tools:
 *   echo       — echoes input text back
 *   timestamp  — returns the current ISO timestamp
 *   add        — adds two numbers
 *   list_files — lists files in a directory (defaults to cwd)
 *
 * Run directly with Bun:
 *   bun packages/controller/mcp/src/test-server.ts
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import * as fs from "node:fs"
import * as path from "node:path"

// ---------------------------------------------------------------------------
// Tool definitions (raw JSON Schema — no zod)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "echo",
    description: "Returns the input text back to the caller.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "Text to echo" },
      },
      required: ["text"],
    },
  },
  {
    name: "timestamp",
    description: "Returns the current date and time as an ISO 8601 string.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "add",
    description: "Adds two numbers and returns their sum.",
    inputSchema: {
      type: "object" as const,
      properties: {
        a: { type: "number", description: "First operand" },
        b: { type: "number", description: "Second operand" },
      },
      required: ["a", "b"],
    },
  },
  {
    name: "list_files",
    description: "Lists files in a directory. Defaults to the current working directory.",
    inputSchema: {
      type: "object" as const,
      properties: {
        directory: { type: "string", description: "Directory path to list (defaults to cwd)" },
      },
      required: [],
    },
  },
]

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "neko-test-server", version: "0.1.0" },
  { capabilities: { tools: {} } },
)

// List tools
server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }))

// Call tool
server.setRequestHandler(CallToolRequestSchema, (request) => {
  const { name, arguments: args } = request.params
  const input = (args ?? {}) as Record<string, unknown>

  switch (name) {
    case "echo": {
      const text = typeof input.text === "string" ? input.text : ""
      return {
        content: [{ type: "text" as const, text }],
      }
    }

    case "timestamp": {
      return {
        content: [{ type: "text" as const, text: new Date().toISOString() }],
      }
    }

    case "add": {
      const a = typeof input.a === "number" ? input.a : Number(input.a)
      const b = typeof input.b === "number" ? input.b : Number(input.b)
      if (Number.isNaN(a) || Number.isNaN(b)) {
        return {
          content: [{ type: "text" as const, text: "Error: a and b must be numbers" }],
          isError: true,
        }
      }
      return {
        content: [{ type: "text" as const, text: String(a + b) }],
      }
    }

    case "list_files": {
      const dir =
        typeof input.directory === "string" && input.directory.trim()
          ? path.resolve(input.directory)
          : process.cwd()
      try {
        const entries = fs.readdirSync(dir)
        return {
          content: [{ type: "text" as const, text: entries.join("\n") }],
        }
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error reading directory: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }

    default:
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      }
  }
})

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport()
await server.connect(transport)

// To use: add to neko.json:
// { "mcp": { "test": { "type": "local", "command": ["bun", "packages/controller/mcp/src/test-server.ts"] } } }
