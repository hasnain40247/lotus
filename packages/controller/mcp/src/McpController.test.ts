import { describe, test, expect } from "bun:test"
import path from "node:path"
import { Effect, Layer, ManagedRuntime } from "effect"
import { McpController } from "./McpController"
import { McpAuthController } from "./McpAuthController"

// Both test MCP servers are launched via stdio subprocess. Keep timeouts
// generous — Bun cold-start + MCP handshake can be slow on first run.
// __dirname is packages/controller/mcp/src → 4 levels up is the repo root.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..")

const TEST_CONFIGS = {
  test: {
    type: "local" as const,
    command: ["bun", "packages/controller/mcp/src/test-server.ts"],
  },
  notes: {
    type: "local" as const,
    command: ["bun", "packages/controller/mcp/src/test-server-notes.ts"],
  },
}

describe("McpController — two local test servers", () => {
  test("connects both servers and lists tools from each", async () => {
    const appLayer = McpController.layer(REPO_ROOT).pipe(
      Layer.provide(McpAuthController.layer),
    )
    const rt = ManagedRuntime.make(appLayer)

    try {
      await rt.runPromise(
        Effect.gen(function* () {
          const mcp = yield* McpController.Service
          yield* mcp.loadConfig(TEST_CONFIGS as any, REPO_ROOT)

          const status = yield* mcp.status()
          expect(status.test?.status).toBe("connected")
          expect(status.notes?.status).toBe("connected")

          const defs = yield* mcp.serverDefs()
          expect(new Set(defs.test)).toEqual(
            new Set(["echo", "timestamp", "add", "list_files"]),
          )
          expect(new Set(defs.notes)).toEqual(
            new Set(["note_set", "note_get", "note_list", "note_delete"]),
          )

          const tools = yield* mcp.tools()
          const keys = Object.keys(tools).sort()
          // Format is `{server}_{tool}`, both sanitized. Just assert we have
          // entries from both servers.
          expect(keys.some((k) => k.startsWith("test_"))).toBe(true)
          expect(keys.some((k) => k.startsWith("notes_"))).toBe(true)
        }),
      )
    } finally {
      await rt.dispose()
    }
  }, 30_000)

  test("calls a tool on each server end-to-end", async () => {
    const appLayer = McpController.layer(REPO_ROOT).pipe(
      Layer.provide(McpAuthController.layer),
    )
    const rt = ManagedRuntime.make(appLayer)

    try {
      await rt.runPromise(
        Effect.gen(function* () {
          const mcp = yield* McpController.Service
          yield* mcp.loadConfig(TEST_CONFIGS as any, REPO_ROOT)

          const clients = yield* mcp.clients()

          // Call `add` on the "test" server.
          const addResult = yield* Effect.tryPromise(() =>
            clients.test!.callTool({ name: "add", arguments: { a: 2, b: 3 } }),
          )
          const addContent = (addResult as any).content?.[0]?.text
          expect(addContent).toBe("5")

          // Call `note_set` then `note_get` on the "notes" server.
          yield* Effect.tryPromise(() =>
            clients.notes!.callTool({
              name: "note_set",
              arguments: { key: "hello", value: "world" },
            }),
          )
          const getResult = yield* Effect.tryPromise(() =>
            clients.notes!.callTool({ name: "note_get", arguments: { key: "hello" } }),
          )
          const getContent = (getResult as any).content?.[0]?.text
          expect(getContent).toBe("world")
        }),
      )
    } finally {
      await rt.dispose()
    }
  }, 30_000)
})
