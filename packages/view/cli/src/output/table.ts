/**
 * ASCII table builder for terminal output.
 * All functions are pure — they return strings without side effects.
 */

/**
 * Truncates a string to at most `maxLen` characters, appending "…" when cut.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + "…"
}

/**
 * Left-pads or right-pads `str` with spaces so that it is exactly `width`
 * characters wide (measured in code-points, not bytes).
 * Strings that are already wider than `width` are returned unchanged.
 */
export function pad(str: string, width: number): string {
  if (str.length >= width) return str
  return str + " ".repeat(width - str.length)
}

/**
 * Renders a simple ASCII table.
 *
 * @param headers - Column header strings.
 * @param rows    - Data rows; each inner array must have the same length as `headers`.
 * @returns       A multi-line string suitable for `console.log`.
 */
export function table(headers: string[], rows: string[][]): string {
  // Compute column widths = max(header length, widest cell in that column).
  const widths = headers.map((h, i) => {
    const maxCell = rows.reduce((acc, row) => Math.max(acc, (row[i] ?? "").length), 0)
    return Math.max(h.length, maxCell)
  })

  const separator = widths.map((w) => "─".repeat(w)).join("  ")
  const headerRow = headers.map((h, i) => pad(h, widths[i]!)).join("  ")

  const dataRows = rows.map((row) =>
    row.map((cell, i) => pad(cell ?? "", widths[i]!)).join("  "),
  )

  return [headerRow, separator, ...dataRows].join("\n")
}
