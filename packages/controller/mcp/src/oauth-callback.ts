/**
 * Local OAuth callback HTTP server for MCP authentication flows.
 *
 * Ported from packages/neko/src/mcp/oauth-callback.ts.
 * The OauthCallbackPage dependency is inlined to avoid @neko/core.
 */
export * as McpOAuthCallback from "./oauth-callback"

import { createConnection } from "net"
import { createServer } from "http"
import { OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH, parseRedirectUri } from "./oauth-provider"

const OAUTH_CALLBACK_HOST = "127.0.0.1"

// Current callback server configuration (may differ from defaults if custom redirectUri is used)
let currentPort = OAUTH_CALLBACK_PORT
let currentPath = OAUTH_CALLBACK_PATH

interface PendingAuth {
  resolve: (code: string) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

let server: ReturnType<typeof createServer> | undefined
const pendingAuths = new Map<string, PendingAuth>()
// Reverse index: mcpName → oauthState, so cancelPending(mcpName) can
// find the right entry in pendingAuths (which is keyed by oauthState).
const mcpNameToState = new Map<string, string>()

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function callbackPage(status: "success" | "error", detail?: string): string {
  const isSuccess = status === "success"
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${isSuccess ? "Authorization successful" : "Authorization failed"} · Neko Code</title>
  <style>
    body { font-family: ui-sans-serif,system-ui,sans-serif; display:grid; place-items:center; min-height:100vh; margin:0; background:#f8f8f8; color:#6f6f6f; }
    .card { background:#fcfcfc; border:1px solid #e5e5e5; border-radius:14px; padding:2.25rem 2rem 1.75rem; text-align:center; width:min(100%,28rem); }
    h1 { margin:0; font-size:1.1875rem; font-weight:500; color:#171717; }
    p { margin:.5rem 0 0; font-size:.9375rem; }
    pre { background:#fff8f6; border:1px solid #fdc3b7; border-radius:8px; padding:.75rem; text-align:left; font-size:.8125rem; white-space:pre-wrap; word-break:break-word; margin:1.25rem 0 0; }
    .fn { margin:1.5rem 0 0; font-size:.8125rem; color:#8f8f8f; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${isSuccess ? "Authorization successful" : "Authorization failed"}</h1>
    <p>${isSuccess ? "Neko Code is now connected to MCP." : "Neko Code could not complete MCP authorization."}${detail ? "" : ""}</p>
    ${detail ? `<pre>${escapeHtml(detail)}</pre>` : ""}
    <p class="fn">${isSuccess ? "You can close this window." : "Close this window and try again from Neko Code."}</p>
  </div>
  ${isSuccess ? "<script>setTimeout(function(){try{window.close()}catch(e){}},2500)</script>" : ""}
</body>
</html>`
}

function cleanupStateIndex(oauthState: string) {
  for (const [name, state] of mcpNameToState) {
    if (state === oauthState) {
      mcpNameToState.delete(name)
      break
    }
  }
}

function stopIfIdle() {
  if (pendingAuths.size > 0 || !server) return
  server.close()
  server = undefined
}

function handleRequest(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  const url = new URL(req.url || "/", `http://localhost:${currentPort}`)

  if (url.pathname !== currentPath) {
    res.writeHead(404)
    res.end("Not found")
    return
  }

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const error = url.searchParams.get("error")
  const errorDescription = url.searchParams.get("error_description")

  // Enforce state parameter presence
  if (!state) {
    const errorMsg = "Missing required state parameter - potential CSRF attack"
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
    res.end(callbackPage("error", errorMsg))
    return
  }

  if (error) {
    const errorMsg = errorDescription || error
    if (pendingAuths.has(state)) {
      const pending = pendingAuths.get(state)!
      clearTimeout(pending.timeout)
      pendingAuths.delete(state)
      cleanupStateIndex(state)
      pending.reject(new Error(errorMsg))
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(callbackPage("error", errorMsg))
    stopIfIdle()
    return
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
    res.end(callbackPage("error", "No authorization code provided"))
    return
  }

  // Validate state parameter
  if (!pendingAuths.has(state)) {
    const errorMsg = "Invalid or expired state parameter - potential CSRF attack"
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
    res.end(callbackPage("error", errorMsg))
    return
  }

  const pending = pendingAuths.get(state)!
  clearTimeout(pending.timeout)
  pendingAuths.delete(state)
  cleanupStateIndex(state)
  pending.resolve(code)

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(callbackPage("success"))
  stopIfIdle()
}

export async function ensureRunning(redirectUri?: string): Promise<void> {
  // Parse the redirect URI to get port and path (uses defaults if not provided)
  const { port, path } = parseRedirectUri(redirectUri)

  // If server is running on a different port/path, stop it first
  if (server && (currentPort !== port || currentPath !== path)) {
    await stop()
  }

  if (server) return

  const running = await isPortInUse(port)
  if (running) return

  currentPort = port
  currentPath = path

  server = createServer(handleRequest)
  await new Promise<void>((resolve, reject) => {
    server!.listen(currentPort, OAUTH_CALLBACK_HOST, () => {
      resolve()
    })
    server!.on("error", reject)
  })
}

export function waitForCallback(oauthState: string, mcpName?: string): Promise<string> {
  if (mcpName) mcpNameToState.set(mcpName, oauthState)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingAuths.has(oauthState)) {
        pendingAuths.delete(oauthState)
        if (mcpName) mcpNameToState.delete(mcpName)
        reject(new Error("OAuth callback timeout - authorization took too long"))
        stopIfIdle()
      }
    }, CALLBACK_TIMEOUT_MS)

    pendingAuths.set(oauthState, { resolve, reject, timeout })
  })
}

export function cancelPending(mcpName: string): void {
  // Look up the oauthState for this mcpName via the reverse index
  const oauthState = mcpNameToState.get(mcpName)
  const key = oauthState ?? mcpName
  const pending = pendingAuths.get(key)
  if (pending) {
    clearTimeout(pending.timeout)
    pendingAuths.delete(key)
    mcpNameToState.delete(mcpName)
    pending.reject(new Error("Authorization cancelled"))
    stopIfIdle()
  }
}

export async function isPortInUse(port: number = OAUTH_CALLBACK_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(port, "127.0.0.1")
    socket.on("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.on("error", () => {
      resolve(false)
    })
  })
}

export async function stop(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
  }

  for (const [_name, pending] of pendingAuths) {
    clearTimeout(pending.timeout)
    pending.reject(new Error("OAuth callback server stopped"))
  }
  pendingAuths.clear()
  mcpNameToState.clear()
}

export function isRunning(): boolean {
  return server !== undefined
}
