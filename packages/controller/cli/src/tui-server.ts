/**
 * tui-server.ts — minimal in-process HTTP server for the TUI client.
 *
 * The TUI (view/tui) is an HTTP client that expects a running opencode-compatible
 * server. This module starts a Bun.serve instance that returns the minimum valid
 * responses needed for the TUI to boot and render. Real routes (session creation,
 * LLM calls) will be wired to Effect controllers incrementally.
 */

import type { Server } from "bun"
import * as os from "node:os"
import * as path from "node:path"

// ─── SSE helpers ─────────────────────────────────────────────────────────────

type SSESend = (event: string, data: unknown) => void
const sseClients = new Set<SSESend>()

export function broadcastEvent(event: string, data: unknown): void {
  for (const send of sseClients) send(event, data)
}

function sseStream(): Response {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      let closed = false

      const send: SSESend = (event, data) => {
        if (closed) return
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        controller.enqueue(encoder.encode(payload))
      }

      sseClients.add(send)

      // Keepalive ping every 15 s
      const timer = setInterval(() => {
        if (closed) return
        controller.enqueue(encoder.encode(": ping\n\n"))
      }, 15_000)

      // Cleanup when client disconnects
      return () => {
        closed = true
        clearInterval(timer)
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

// ─── Route handler ───────────────────────────────────────────────────────────

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })

const emptyProviders = {
  all: [],
  providers: [],
  default: {},
  connected: [],
}

function handleRequest(req: Request, directory: string): Response {
  const url = new URL(req.url)
  const pathname = url.pathname
  const method = req.method

  // ── Health ────────────────────────────────────────────────────────────────
  if (pathname === "/global/health") return new Response("OK")

  // ── SSE event stream ──────────────────────────────────────────────────────
  if (pathname === "/global/event" && method === "GET") return sseStream()

  // ── Config ────────────────────────────────────────────────────────────────
  if ((pathname === "/config" || pathname === "/global/config") && method === "GET")
    return json({})

  if (pathname === "/config" && method === "PATCH")
    return json({})

  // ── Providers ─────────────────────────────────────────────────────────────
  if (pathname === "/config/providers" && method === "GET") return json(emptyProviders)
  if (pathname === "/provider" && method === "GET") return json(emptyProviders)
  if (pathname === "/provider/auth" && method === "GET") return json({})

  // ── Agents ────────────────────────────────────────────────────────────────
  if (pathname === "/agent" && method === "GET") return json([])

  // ── Skills ────────────────────────────────────────────────────────────────
  if (pathname === "/skill" && method === "GET") return json([])

  // ── Sessions ──────────────────────────────────────────────────────────────
  if (pathname === "/session" && method === "GET") return json([])
  if (pathname === "/session/status" && method === "GET") return json({})
  if (pathname === "/session" && method === "POST") {
    const id = `ses_${Date.now()}`
    return json({ id, time: { created: Date.now(), updated: Date.now() } })
  }

  // ── Permissions / Questions ───────────────────────────────────────────────
  if (pathname === "/permission" && method === "GET") return json([])
  if (pathname === "/question" && method === "GET") return json([])

  // ── Commands ─────────────────────────────────────────────────────────────
  if (pathname === "/command" && method === "GET") return json([])

  // ── LSP / Formatter ───────────────────────────────────────────────────────
  if (pathname === "/lsp" && method === "GET") return json([])
  if (pathname === "/formatter" && method === "GET") return json([])

  // ── MCP ───────────────────────────────────────────────────────────────────
  if (pathname === "/mcp" && method === "GET") return json({})

  // ── VCS ───────────────────────────────────────────────────────────────────
  if (pathname === "/vcs" && method === "GET") return json(undefined)
  if (pathname === "/vcs/status" && method === "GET") return json([])
  if (pathname === "/vcs/diff" && method === "GET") return json({})

  // ── Path ──────────────────────────────────────────────────────────────────
  if (pathname === "/path" && method === "GET") {
    const home = os.homedir()
    const state = path.join(home, ".local", "share", "gcloud-opencode")
    return json({
      home,
      state,
      config: path.join(home, ".config", "gcloud-opencode"),
      worktree: path.join(state, "worktree"),
      directory,
    })
  }

  // ── Projects ──────────────────────────────────────────────────────────────
  if (pathname === "/project" && method === "GET") return json([])
  if (pathname === "/project/current" && method === "GET") {
    return json({
      id: encodeURIComponent(directory),
      worktree: directory,
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    })
  }
  // /project/{id}/directories
  if (/^\/project\/[^/]+\/directories$/.test(pathname) && method === "GET") {
    return json([{ directory }])
  }

  // ── Experimental (all optional — TUI catches errors) ──────────────────────
  if (pathname.startsWith("/experimental/capabilities")) return json({ backgroundSubagents: false })
  if (pathname.startsWith("/experimental/console")) return json({ consoleManagedProviders: [], switchableOrgCount: 0 })
  if (pathname.startsWith("/experimental/session")) return json([])
  if (pathname.startsWith("/experimental/workspace")) return json([])
  if (pathname.startsWith("/experimental/resource")) return json({})

  // ── Default: 404 ──────────────────────────────────────────────────────────
  return json({ error: `Not implemented: ${method} ${pathname}` }, 404)
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

export function startTuiServer(directory: string): Server {
  return Bun.serve({
    port: 0, // OS assigns a free port
    idleTimeout: 0, // SSE connections must not be timed out
    fetch(req) {
      try {
        return handleRequest(req, directory)
      } catch (err) {
        console.error("[tui-server] unhandled error:", err)
        return json({ error: "Internal server error" }, 500)
      }
    },
  })
}
