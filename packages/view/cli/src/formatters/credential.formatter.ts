/**
 * Pure formatters for Credential data.
 * Uses plain TypeScript types rather than Effect Schema types.
 */

import { table, truncate } from "../output/table.js"
import { color } from "../output/color.js"

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Formatter-facing credential descriptor.
 * Uses plain strings rather than branded Effect types.
 */
export interface CredentialDisplayInfo {
  readonly id: string
  readonly integrationID: string
  readonly label: string
  /** Whether a credential value is present (key or oauth token). */
  readonly hasValue: boolean
  /** Unix timestamp (ms) of the last update, or undefined if unknown. */
  readonly updatedAt?: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Formatters ───────────────────────────────────────────────────────────────

/**
 * Renders a list of credentials as an ASCII table.
 *
 * Columns: Integration, Label, Has Value, Last Updated
 */
export function formatCredentialList(credentials: CredentialDisplayInfo[]): string {
  if (credentials.length === 0) return color.gray("No credentials stored.")

  const headers = ["Integration", "Label", "Has Value", "Last Updated"]

  const rows = credentials.map((c) => [
    c.integrationID,
    truncate(c.label, 30) || color.gray("(unnamed)"),
    c.hasValue ? color.green("yes") : color.red("no"),
    c.updatedAt !== undefined ? formatDate(c.updatedAt) : color.gray("—"),
  ])

  const rendered = table(headers, rows)

  const hasValue = credentials.filter((c) => c.hasValue).length
  const footer = `\n${color.gray(`${credentials.length} credential(s)  •  ${hasValue} with value`)}`

  return rendered + footer
}
