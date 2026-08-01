/**
 * tui-server.ts — in-process HTTP server for the TUI client.
 *
 * Implements the opencode-compatible REST + SSE API that @gco/view-tui
 * connects to. Routes are backed by real Effect services passed in from
 * TuiCommand (which runs them inside a single Effect scope so their
 * lifecycle stays tied to the TUI session).
 */

import type { Server } from "bun"
import * as os from "node:os"
import * as path from "node:path"

// ─── Service interface ────────────────────────────────────────────────────────

export interface TuiServerServices {
  readonly createSession: (input: {
    projectID: string
    title?: string
    agent?: string
    model?: { id: string; providerID: string }
    location: { directory: string }
  }) => Promise<any>
  readonly getSession: (id: string) => Promise<any>
  readonly listSessions: (projectID: string) => Promise<any[]>
  readonly prompt: (input: {
    sessionID: string
    text: string
    files?: any[]
    parts?: any[]
    id?: string
  }) => Promise<void>
  readonly loadEvents: (sessionID: string) => Promise<any[]>
  readonly listAgents: () => Promise<any[]>
}

// ─── SSE helpers ─────────────────────────────────────────────────────────────

type SSESend = (raw: string) => void
const sseClients = new Set<SSESend>()

function broadcastSSE(globalEvent: object): void {
  const raw = `data: ${JSON.stringify(globalEvent)}\n\n`
  for (const send of sseClients) send(raw)
}

function toGlobalEvent(event: any, directory: string): object {
  return {
    directory,
    payload: {
      id: event.id ?? `evt_${Date.now()}`,
      type: event.type,
      properties: event.data ?? {},
    },
  }
}

// Per-session polling — starts when prompt is submitted, stops after idle.
const activePollers = new Map<string, () => void>()

async function startEventPoller(
  sessionID: string,
  directory: string,
  loadEvents: (id: string) => Promise<any[]>,
): Promise<void> {
  if (activePollers.has(sessionID)) return
  let running = true
  activePollers.set(sessionID, () => { running = false })

  let seenCount = 0
  let idleMs = 0
  const IDLE_STOP_MS = 60_000  // stop polling 60 s after last event

  while (running) {
    const events = await loadEvents(sessionID).catch(() => [] as any[])
    const newEvents = events.slice(seenCount)
    seenCount = events.length

    if (newEvents.length > 0) {
      idleMs = 0
      for (const ev of newEvents) {
        broadcastSSE(toGlobalEvent(ev, directory))

        // Emit high-level session.updated so the sidebar refreshes
        if (ev.type === "session.next.step.ended") {
          broadcastSSE({
            directory,
            payload: {
              id: `upd_${Date.now()}`,
              type: "session.updated",
              properties: { sessionID },
            },
          })
        }
      }

      // Check if the turn is done — stop after step.ended / step.failed
      const done = newEvents.some(
        (e) =>
          e.type === "session.next.step.ended" ||
          e.type === "session.next.step.failed",
      )
      if (done) {
        // Wait a bit for any trailing events, then stop
        await new Promise((r) => setTimeout(r, 500))
        const finalEvents = await loadEvents(sessionID).catch(() => [] as any[])
        for (const ev of finalEvents.slice(seenCount)) {
          broadcastSSE(toGlobalEvent(ev, directory))
        }
        running = false
        break
      }
    } else {
      idleMs += 150
      if (idleMs >= IDLE_STOP_MS) {
        running = false
        break
      }
    }

    await new Promise((r) => setTimeout(r, 150))
  }

  activePollers.delete(sessionID)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })

function sessionToSDK(info: any): object {
  const toMs = (dt: unknown): number => {
    if (typeof dt === "number") return dt
    if (dt && typeof (dt as any).epochMillis === "number") return (dt as any).epochMillis
    if (dt instanceof Date) return dt.getTime()
    return Date.now()
  }
  return {
    id: String(info.id),
    slug: String(info.id),
    projectID: String(info.projectID),
    directory: info.location?.directory ?? "",
    title: info.title ?? "Untitled",
    version: "0.1.0",
    cost: info.cost ?? 0,
    tokens: info.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    model: info.model
      ? { id: info.model.id, providerID: (info.model as any).providerID ?? "deepseek" }
      : { id: "deepseek-chat", providerID: "deepseek" },
    time: {
      created: toMs(info.time?.created),
      updated: toMs(info.time?.updated),
    },
  }
}

function deepseekProvider(): object {
  const connected = Boolean(process.env.DEEPSEEK_API_KEY)
  return {
    id: "deepseek",
    name: "DeepSeek",
    source: "config",
    env: ["DEEPSEEK_API_KEY"],
    key: connected ? "***" : undefined,
    options: {},
    models: {
      "deepseek-chat": {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        release: "2025",
        context: 65536,
        limit: { context: 65536, output: 8192 },
      },
      "deepseek-coder": {
        id: "deepseek-coder",
        name: "DeepSeek Coder",
        release: "2025",
        context: 65536,
        limit: { context: 65536, output: 8192 },
      },
      "deepseek-reasoner": {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner (R1)",
        release: "2025",
        context: 65536,
        limit: { context: 65536, output: 8192 },
      },
    },
  }
}

function providerListResponse(): object {
  const ds = deepseekProvider() as any
  const connected = process.env.DEEPSEEK_API_KEY ? [ds.id] : []
  return {
    all: [ds],
    providers: [ds],
    default: { deepseek: "deepseek-chat" },
    connected,
  }
}

// ─── Route handler ───────────────────────────────────────────────────────────

function handleRequest(
  req: Request,
  directory: string,
  services: TuiServerServices,
): Response | Promise<Response> {
  const url = new URL(req.url)
  const pathname = url.pathname
  const method = req.method

  // ── Health ────────────────────────────────────────────────────────────────
  if (pathname === "/global/health") return new Response("OK")

  // ── SSE event stream ──────────────────────────────────────────────────────
  if (pathname === "/global/event" && method === "GET") {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        let closed = false
        const send: SSESend = (raw) => {
          if (!closed) controller.enqueue(encoder.encode(raw))
        }
        sseClients.add(send)

        // Send server.connected immediately
        send(
          `data: ${JSON.stringify({
            directory,
            payload: { id: `conn_${Date.now()}`, type: "server.connected", properties: {} },
          })}\n\n`,
        )

        const ping = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": ping\n\n"))
        }, 15_000)

        return () => {
          closed = true
          clearInterval(ping)
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

  // ── Config ────────────────────────────────────────────────────────────────
  if ((pathname === "/config" || pathname === "/global/config") && method === "GET")
    return json({ model: "deepseek/deepseek-chat" })

  if ((pathname === "/config" || pathname === "/global/config") && method === "PATCH")
    return json({})

  // ── Providers ─────────────────────────────────────────────────────────────
  if (
    (pathname === "/config/providers" || pathname === "/provider") &&
    method === "GET"
  )
    return json(providerListResponse())

  if (pathname === "/provider/auth" && method === "GET") return json({})

  // ── Agents ────────────────────────────────────────────────────────────────
  if (pathname === "/agent" && method === "GET") {
    return (async () => {
      const agents = await services.listAgents().catch(() => [])
      const sdkAgents = agents
        .filter((a) => !a.hidden)
        .map((a) => ({
          name: a.name ?? a.id,
          description: a.description,
          mode: a.mode ?? "primary",
          native: true,
          hidden: false,
          permission: {},
          options: {},
        }))
      return json(sdkAgents)
    })()
  }

  // ── Skills ────────────────────────────────────────────────────────────────
  if (pathname === "/skill" && method === "GET") return json([])

  // ── Sessions — list ───────────────────────────────────────────────────────
  if (pathname === "/session" && method === "GET") {
    return (async () => {
      const projectID = encodeURIComponent(directory)
      const sessions = await services.listSessions(projectID).catch(() => [])
      return json(sessions.map(sessionToSDK))
    })()
  }

  // ── Sessions — status ─────────────────────────────────────────────────────
  if (pathname === "/session/status" && method === "GET") return json({})

  // ── Sessions — create ─────────────────────────────────────────────────────
  if (pathname === "/session" && method === "POST") {
    return (async () => {
      let body: any = {}
      try {
        body = await req.json()
      } catch {}
      const projectID = encodeURIComponent(directory)
      const session = await services.createSession({
        projectID,
        title: body.title,
        agent: body.agent,
        model: body.model ?? { id: "deepseek-chat", providerID: "deepseek", variant: undefined },
        location: { directory: body.directory ?? directory },
      })
      const sdkSession = sessionToSDK(session)

      // Broadcast session.created
      broadcastSSE({
        directory,
        payload: {
          id: `sc_${Date.now()}`,
          type: "session.created",
          properties: { sessionID: (sdkSession as any).id, info: sdkSession },
        },
      })

      return json(sdkSession)
    })()
  }

  // ── Sessions — get ────────────────────────────────────────────────────────
  const sessionMatch = pathname.match(/^\/session\/([^/]+)$/)
  if (sessionMatch && method === "GET") {
    const sessionID = sessionMatch[1]!
    return (async () => {
      const session = await services.getSession(sessionID).catch(() => null)
      if (!session) return json({ error: "Not found" }, 404)
      return json(sessionToSDK(session))
    })()
  }

  // ── Sessions — prompt ─────────────────────────────────────────────────────
  const promptMatch = pathname.match(/^\/session\/([^/]+)\/prompt$/)
  if (promptMatch && method === "POST") {
    const sessionID = promptMatch[1]!
    return (async () => {
      let body: any = {}
      try {
        body = await req.json()
      } catch {}
      const text = body.text ?? body.parts?.[0]?.text ?? ""

      // Fire-and-forget — the runner runs in background
      services
        .prompt({ sessionID, text, files: body.files ?? [], parts: body.parts ?? [] })
        .catch((err) => console.error("[tui-server] prompt error:", err))

      // Start polling for events produced by this session
      startEventPoller(sessionID, directory, services.loadEvents).catch(
        (err) => console.error("[tui-server] poller error:", err),
      )

      const msgID = `msg_${Date.now()}`
      return json({
        id: msgID,
        sessionID,
        role: "user",
        time: { created: Date.now(), updated: Date.now() },
        parts: [{ id: `part_${Date.now()}`, type: "text", text }],
      })
    })()
  }

  // ── Sessions — messages ───────────────────────────────────────────────────
  const msgMatch = pathname.match(/^\/session\/([^/]+)\/message$/)
  if (msgMatch && method === "GET") return json([])

  // ── Sessions — parts ──────────────────────────────────────────────────────
  const partMatch = pathname.match(/^\/session\/([^/]+)\/message\/([^/]+)\/part$/)
  if (partMatch && method === "GET") return json([])

  // ── Sessions — diff / todo / fork / share / abort ─────────────────────────
  if (pathname.includes("/diff") && method === "GET") return json([])
  if (pathname.includes("/todo") && method === "GET") return json([])
  if (pathname.includes("/fork") && method === "POST") return json({})
  if (pathname.includes("/share") && method === "POST") return json({})
  if (pathname.includes("/abort") && method === "POST") return json({})

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
  if (/^\/project\/[^/]+\/directories$/.test(pathname) && method === "GET") {
    return json([{ directory }])
  }

  // ── Experimental ──────────────────────────────────────────────────────────
  if (pathname.startsWith("/experimental/capabilities")) return json({ backgroundSubagents: false })
  if (pathname.startsWith("/experimental/console")) return json({ consoleManagedProviders: [], switchableOrgCount: 0 })
  if (pathname.startsWith("/experimental/session")) return json([])
  if (pathname.startsWith("/experimental/workspace")) return json([])
  if (pathname.startsWith("/experimental/resource")) return json({})

  // ── Dispose ───────────────────────────────────────────────────────────────
  if (pathname === "/global/dispose" && method === "POST") return json({})

  // ── Default ───────────────────────────────────────────────────────────────
  return json({ error: `Not implemented: ${method} ${pathname}` }, 404)
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

export function startTuiServer(directory: string, services: TuiServerServices): Server {
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      try {
        return handleRequest(req, directory, services) ?? json({}, 204)
      } catch (err) {
        console.error("[tui-server] unhandled error:", err)
        return json({ error: "Internal server error" }, 500)
      }
    },
  })
  process.stderr.write(`[tui-server] listening on http://localhost:${server.port}\n`)
  return server
}
