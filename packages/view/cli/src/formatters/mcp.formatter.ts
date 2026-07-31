/**
 * Pure formatters for MCP (Model Context Protocol) server data.
 */

import { table, truncate } from "../output/table.js"
import { color } from "../output/color.js"

// ─── Types ────────────────────────────────────────────────────────────────────

export type McpServerStatus =
  | "connected"
  | "disabled"
  | "failed"
  | "needs_auth"
  | "not_initialized"

export interface McpServerInfo {
  readonly name: string
  /** "local" = stdio subprocess; "remote" = HTTP/SSE URL. */
  readonly type: "local" | "remote"
  readonly status: McpServerStatus
  /** URL (remote) or command (local) shown as location hint. */
  readonly location: string
  /** Number of tools exposed by this server (undefined if not connected). */
  readonly toolCount?: number
  /** Error message if status is "failed". */
  readonly error?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusLabel(status: McpServerStatus): string {
  switch (status) {
    case "connected":       return color.green("connected")
    case "disabled":        return color.gray("disabled")
    case "failed":          return color.red("failed")
    case "needs_auth":      return color.yellow("needs auth")
    case "not_initialized": return color.gray("not initialized")
  }
}

function statusIcon(status: McpServerStatus): string {
  switch (status) {
    case "connected":       return color.green("✔")
    case "disabled":        return color.gray("○")
    case "failed":          return color.red("✖")
    case "needs_auth":      return color.yellow("⚠")
    case "not_initialized": return color.gray("○")
  }
}

function typeLabel(type: McpServerInfo["type"]): string {
  return type === "local" ? color.blue("local") : color.blue("remote")
}

// ─── Formatters ───────────────────────────────────────────────────────────────

/**
 * Renders a list of MCP servers as an ASCII table.
 *
 * Columns: Name, Type, Status, Tools, Location
 */
export function formatMcpList(servers: McpServerInfo[]): string {
  if (servers.length === 0) return color.gray("No MCP servers configured.")

  const headers = ["", "Name", "Type", "Status", "Tools", "Location"]

  const rows = servers.map((s) => [
    statusIcon(s.status),
    s.name,
    typeLabel(s.type),
    statusLabel(s.status),
    s.toolCount !== undefined ? String(s.toolCount) : color.gray("—"),
    color.gray(truncate(s.location, 50)),
  ])

  const rendered = table(headers, rows)

  const connected = servers.filter((s) => s.status === "connected").length
  const footer = `\n${color.gray(`${servers.length} server(s)  •  ${connected} connected`)}`

  return rendered + footer
}

/**
 * Renders the full status block for a single MCP server.
 */
export function formatMcpStatus(server: McpServerInfo): string {
  const icon = statusIcon(server.status)
  const heading = `${icon}  ${color.bold(server.name)}  ${typeLabel(server.type)}`

  const lines: string[] = [
    heading,
    `  ${color.gray("Status")}    ${statusLabel(server.status)}`,
    `  ${color.gray("Location")}  ${server.location}`,
  ]

  if (server.toolCount !== undefined) {
    lines.push(`  ${color.gray("Tools")}     ${server.toolCount}`)
  }

  if (server.error && server.status === "failed") {
    lines.push(`  ${color.gray("Error")}     ${color.red(server.error)}`)
  }

  return lines.join("\n")
}
