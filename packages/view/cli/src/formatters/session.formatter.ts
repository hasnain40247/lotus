/**
 * Pure formatters for Session data.
 * No side effects, no GCP imports — just string in, string out.
 *
 * Uses plain TypeScript interfaces rather than Effect Schema types so that this
 * package stays free of the `effect` peer dependency at compile time.
 * Controllers are responsible for mapping Session.Info → SessionInfo.
 */

import { table, truncate } from "../output/table.js"
import { color } from "../output/color.js"

// ─── Types ────────────────────────────────────────────────────────────────────

/** Plain-TS projection of Session.Info used by the formatter. */
export interface SessionInfo {
  readonly id: string
  readonly title: string
  /** Agent ID, if set. */
  readonly agent?: string
  /** Model reference as "providerID/modelID", if set. */
  readonly model?: string
  readonly cost: number
  readonly tokens: {
    readonly input: number
    readonly output: number
    readonly reasoning: number
  }
  /** Unix timestamp in milliseconds. */
  readonly createdAt: number
  /** Unix timestamp in milliseconds. */
  readonly updatedAt: number
  /** Unix timestamp in milliseconds; present when the session is archived. */
  readonly archivedAt?: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formats a Unix timestamp (ms) as a human-readable string.
 * Shows "HH:MM" if the date is today, otherwise "YYYY-MM-DD".
 */
function formatDate(ms: number): string {
  const date = new Date(ms)
  const now = new Date()

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (isToday) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
  }
  return date.toISOString().slice(0, 10)
}

/** Truncates a session ID to its first 8 characters for compact display. */
function shortID(id: string): string {
  return id.slice(0, 8)
}

// ─── Formatters ───────────────────────────────────────────────────────────────

/**
 * Renders a list of sessions as an ASCII table.
 *
 * Columns: ID (8 chars), title (truncated), agent, model, cost, date
 * Archived sessions are dimmed.
 */
export function formatSessionList(sessions: SessionInfo[]): string {
  if (sessions.length === 0) return color.gray("No sessions found.")

  const headers = ["ID", "Title", "Agent", "Model", "Cost ($)", "Updated"]

  const rows = sessions.map((s) => {
    const id = shortID(s.id)
    const title = truncate(s.title, 40)
    const agent = s.agent ?? color.gray("—")
    const model = s.model ?? color.gray("—")
    const cost = s.cost > 0 ? s.cost.toFixed(4) : color.gray("0.0000")
    const updated = formatDate(s.updatedAt)
    const isArchived = s.archivedAt !== undefined

    const row = [id, title, agent, model, cost, updated]

    // Dim the whole row for archived sessions.
    return isArchived ? row.map((cell) => color.dim(cell)) : row
  })

  const rendered = table(headers, rows)

  const archivedCount = sessions.filter((s) => s.archivedAt !== undefined).length
  const footer =
    archivedCount > 0
      ? `\n${color.gray(`${sessions.length} session(s) — ${archivedCount} archived`)}`
      : `\n${color.gray(`${sessions.length} session(s)`)}`

  return rendered + footer
}

/**
 * Renders the detail view for a single session.
 */
export function formatSessionDetail(session: SessionInfo): string {
  const isArchived = session.archivedAt !== undefined
  const statusLabel = isArchived ? color.yellow("archived") : color.green("active")

  const model = session.model ?? color.gray("(default)")
  const agent = session.agent ?? color.gray("(default)")

  const lines: string[] = [
    color.bold("Session") + "  " + session.id,
    "",
    `  ${color.gray("Title")}    ${session.title}`,
    `  ${color.gray("Status")}   ${statusLabel}`,
    `  ${color.gray("Agent")}    ${agent}`,
    `  ${color.gray("Model")}    ${model}`,
    `  ${color.gray("Cost")}     $${session.cost.toFixed(6)}`,
    `  ${color.gray("Tokens")}   in=${session.tokens.input}  out=${session.tokens.output}  reasoning=${session.tokens.reasoning}`,
    `  ${color.gray("Created")}  ${formatDate(session.createdAt)}`,
    `  ${color.gray("Updated")}  ${formatDate(session.updatedAt)}`,
  ]

  if (isArchived && session.archivedAt !== undefined) {
    lines.push(`  ${color.gray("Archived")} ${formatDate(session.archivedAt)}`)
  }

  return lines.join("\n")
}
