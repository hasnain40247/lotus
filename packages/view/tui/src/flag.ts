function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["GCO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"] ?? process.env["OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]

export const Flag = {
  GCO_DISABLE_TERMINAL_TITLE: truthy("GCO_DISABLE_TERMINAL_TITLE") || truthy("OPENCODE_DISABLE_TERMINAL_TITLE"),
  GCO_SHOW_TTFD: truthy("GCO_SHOW_TTFD") || truthy("OPENCODE_SHOW_TTFD"),
  GCO_DISABLE_MOUSE: truthy("GCO_DISABLE_MOUSE") || truthy("OPENCODE_DISABLE_MOUSE"),
  GCO_DISABLE_FFF:
    process.env["GCO_DISABLE_FFF"] === undefined && process.env["OPENCODE_DISABLE_FFF"] === undefined
      ? process.platform === "win32"
      : truthy("GCO_DISABLE_FFF") || truthy("OPENCODE_DISABLE_FFF"),
  GCO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : (copy.toLowerCase() === "true" || copy === "1"),
  GCO_EXPERIMENTAL_WORKSPACES:
    truthy("GCO_EXPERIMENTAL_WORKSPACES") || truthy("OPENCODE_EXPERIMENTAL_WORKSPACES"),
  GCO_ROUTE: process.env["GCO_ROUTE"] ?? process.env["OPENCODE_ROUTE"],
  GCO_FAST_BOOT: Boolean(process.env["GCO_FAST_BOOT"] ?? process.env["OPENCODE_FAST_BOOT"]),

  // Legacy aliases kept for compatibility
  get OPENCODE_DISABLE_TERMINAL_TITLE() { return this.GCO_DISABLE_TERMINAL_TITLE },
  get OPENCODE_SHOW_TTFD() { return this.GCO_SHOW_TTFD },
  get OPENCODE_DISABLE_MOUSE() { return this.GCO_DISABLE_MOUSE },
  get OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT() { return this.GCO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT },
  get OPENCODE_EXPERIMENTAL_WORKSPACES() { return this.GCO_EXPERIMENTAL_WORKSPACES },
}
