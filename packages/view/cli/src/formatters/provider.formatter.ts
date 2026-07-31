/**
 * Pure formatters for Provider data.
 * Only the 4 supported providers are handled: anthropic, vertex-ai, deepseek, ollama.
 * Uses plain TypeScript types rather than Effect Schema types.
 */

import { table } from "../output/table.js"
import { color } from "../output/color.js"

// ─── Types ────────────────────────────────────────────────────────────────────

/** Slimmed-down view type used by the formatter — callers fill these fields. */
export interface ProviderInfo {
  readonly id: string
  readonly name: string
  readonly hasKey: boolean
  /**
   * "local"  — no API key needed (Ollama runs on localhost).
   * "adc"    — uses Application Default Credentials (Vertex AI).
   * "api-key" — needs an explicit API key.
   * "oauth"  — uses an OAuth flow.
   */
  readonly authKind: "api-key" | "oauth" | "local" | "adc"
  readonly disabled?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authStatusLabel(info: ProviderInfo): string {
  if (info.disabled) return color.gray("disabled")
  if (info.authKind === "local") return color.blue("local")
  if (info.authKind === "adc") {
    return info.hasKey ? color.green("ADC (authenticated)") : color.yellow("ADC (no credentials)")
  }
  return info.hasKey ? color.green("authenticated") : color.red("needs key")
}

// ─── Formatters ───────────────────────────────────────────────────────────────

/**
 * Renders a list of providers as an ASCII table.
 *
 * Columns: ID, Name, Auth
 */
export function formatProviderList(providers: ProviderInfo[]): string {
  if (providers.length === 0) return color.gray("No providers available.")

  const headers = ["ID", "Name", "Auth"]

  const rows = providers.map((p) => [
    p.disabled ? color.dim(p.id) : p.id,
    p.disabled ? color.dim(p.name) : p.name,
    authStatusLabel(p),
  ])

  return table(headers, rows)
}

/**
 * Renders a one-line authentication status for a single provider.
 *
 * @param provider - The provider info.
 * @param hasKey   - Whether a credential is currently stored (passed separately
 *                   so the formatter stays free of any credential-lookup logic).
 */
export function formatProviderAuthStatus(provider: ProviderInfo, hasKey: boolean): string {
  const resolved: ProviderInfo = { ...provider, hasKey }

  const name = color.bold(provider.name)
  const id = color.gray(`(${provider.id})`)
  const status = authStatusLabel(resolved)

  return `${name} ${id}  ${status}`
}
