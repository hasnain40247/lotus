/**
 * Pure formatters for Model data.
 * Groups models by provider and optionally shows cost / context window.
 * Uses plain TypeScript types rather than Effect Schema types.
 */

import { color } from "../output/color.js"
import { truncate } from "../output/table.js"

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Formatter-facing model descriptor.
 * Uses plain strings rather than branded Effect types.
 */
export interface ModelInfo {
  readonly id: string
  readonly providerID: string
  readonly name: string
  readonly status: "alpha" | "beta" | "deprecated" | "active"
  readonly enabled: boolean
  /** Max context window in tokens. */
  readonly contextWindow: number
  /** Cost per 1 000 input tokens in USD (0 if unknown). */
  readonly costInputPer1k: number
  /** Cost per 1 000 output tokens in USD (0 if unknown). */
  readonly costOutputPer1k: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: ModelInfo["status"], enabled: boolean): string {
  if (!enabled) return color.dim("disabled")
  switch (status) {
    case "active":     return ""
    case "beta":       return color.yellow("beta")
    case "alpha":      return color.blue("alpha")
    case "deprecated": return color.red("deprecated")
  }
}

function formatCost(per1k: number): string {
  if (per1k === 0) return color.gray("—")
  return `$${per1k.toPrecision(4)}`
}

function formatContext(tokens: number): string {
  if (tokens === 0) return color.gray("—")
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`
  return String(tokens)
}

// ─── Formatters ───────────────────────────────────────────────────────────────

/**
 * Renders a list of models grouped by provider.
 *
 * In normal mode prints `providerID/modelID` (one per line, grouped).
 * In verbose mode adds columns for context window size and cost per 1K tokens.
 *
 * @param models   - Flat list of models (can be mixed providers).
 * @param verbose  - When true, show extra metadata columns.
 */
export function formatModelList(models: ModelInfo[], verbose?: boolean): string {
  if (models.length === 0) return color.gray("No models available.")

  // Group by provider, preserving insertion order.
  const byProvider = new Map<string, ModelInfo[]>()
  for (const m of models) {
    const list = byProvider.get(m.providerID) ?? []
    list.push(m)
    byProvider.set(m.providerID, list)
  }

  const sections: string[] = []

  for (const [providerID, providerModels] of byProvider) {
    const sortedModels = [...providerModels].sort((a, b) => a.id.localeCompare(b.id))
    const heading = color.bold(color.blue(providerID))

    if (!verbose) {
      const lines = sortedModels.map((m) => {
        const badge = statusBadge(m.status, m.enabled)
        const label = badge ? `  ${providerID}/${m.id}  ${badge}` : `  ${providerID}/${m.id}`
        return m.enabled ? label : color.dim(label)
      })
      sections.push([heading, ...lines].join("\n"))
    } else {
      const idWidth = Math.max(...sortedModels.map((m) => m.id.length), 12)
      const nameWidth = Math.max(...sortedModels.map((m) => m.name.length), 12)

      const header =
        "  " +
        "ID".padEnd(idWidth) +
        "  " +
        "Name".padEnd(nameWidth) +
        "  " +
        "Context".padEnd(8) +
        "  " +
        "In/1K".padEnd(10) +
        "  " +
        "Out/1K".padEnd(10) +
        "  " +
        "Status"

      const sep = "  " + "─".repeat(idWidth + nameWidth + 44)

      const lines = sortedModels.map((m) => {
        const badge = statusBadge(m.status, m.enabled)
        const row =
          "  " +
          m.id.padEnd(idWidth) +
          "  " +
          truncate(m.name, nameWidth).padEnd(nameWidth) +
          "  " +
          formatContext(m.contextWindow).padEnd(8) +
          "  " +
          formatCost(m.costInputPer1k).padEnd(10) +
          "  " +
          formatCost(m.costOutputPer1k).padEnd(10) +
          "  " +
          badge
        return m.enabled ? row : color.dim(row)
      })

      sections.push([heading, header, sep, ...lines].join("\n"))
    }
  }

  const totalModels = models.length
  const footer = color.gray(`\n${totalModels} model(s) across ${byProvider.size} provider(s)`)

  return sections.join("\n\n") + footer
}
