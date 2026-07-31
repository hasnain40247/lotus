/**
 * Pure formatters for Agent data.
 * Uses plain TypeScript types rather than Effect Schema types.
 */

import { table, truncate } from "../output/table.js"
import { color } from "../output/color.js"

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Formatter-facing agent descriptor derived from Agent.Info.
 * Uses plain strings rather than branded Effect types.
 */
export interface AgentInfo {
  readonly id: string
  readonly mode: "subagent" | "primary" | "all"
  /** Optional model override expressed as "providerID/modelID". */
  readonly modelOverride?: string
  readonly description?: string
  /** Human-readable list of effective permission rules, e.g. ["read: allow", "edit: deny"]. */
  readonly permissionSummary: readonly string[]
  readonly hidden: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function modeLabel(mode: AgentInfo["mode"]): string {
  switch (mode) {
    case "all":      return color.blue("all")
    case "primary":  return color.green("primary")
    case "subagent": return color.yellow("subagent")
  }
}

// ─── Formatters ───────────────────────────────────────────────────────────────

/**
 * Renders a list of agents as an ASCII table.
 *
 * Columns: Name, Mode, Model override, Description, Permissions
 */
export function formatAgentList(agents: AgentInfo[]): string {
  if (agents.length === 0) return color.gray("No agents found.")

  const visible = agents.filter((a) => !a.hidden)
  const hidden = agents.filter((a) => a.hidden)

  const headers = ["Name", "Mode", "Model", "Description", "Permissions"]

  const rows = visible.map((a) => [
    a.id,
    modeLabel(a.mode),
    a.modelOverride ?? color.gray("—"),
    truncate(a.description ?? "", 40) || color.gray("—"),
    a.permissionSummary.length > 0
      ? truncate(a.permissionSummary.join(", "), 30)
      : color.gray("default"),
  ])

  const rendered = table(headers, rows)

  const footer =
    hidden.length > 0
      ? `\n${color.gray(`${visible.length} agent(s)  •  ${hidden.length} hidden`)}`
      : `\n${color.gray(`${visible.length} agent(s)`)}`

  return rendered + footer
}

/**
 * Renders the full detail view for a single agent.
 */
export function formatAgentDetail(agent: AgentInfo): string {
  const lines: string[] = [
    color.bold("Agent") + "  " + agent.id,
    "",
    `  ${color.gray("Mode")}         ${modeLabel(agent.mode)}`,
    `  ${color.gray("Model")}        ${agent.modelOverride ?? color.gray("(default)")}`,
    `  ${color.gray("Description")}  ${agent.description ?? color.gray("—")}`,
    `  ${color.gray("Hidden")}       ${agent.hidden ? color.yellow("yes") : "no"}`,
  ]

  if (agent.permissionSummary.length > 0) {
    lines.push(`  ${color.gray("Permissions")}`)
    for (const rule of agent.permissionSummary) {
      lines.push(`    ${rule}`)
    }
  } else {
    lines.push(`  ${color.gray("Permissions")}  ${color.gray("(default ruleset)")}`)
  }

  return lines.join("\n")
}
