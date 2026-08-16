function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["NEKO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]

export const Flag = {
  NEKO_DISABLE_TERMINAL_TITLE: truthy("NEKO_DISABLE_TERMINAL_TITLE"),
  NEKO_SHOW_TTFD: truthy("NEKO_SHOW_TTFD"),
  NEKO_DISABLE_MOUSE: truthy("NEKO_DISABLE_MOUSE"),
  NEKO_DISABLE_FFF:
    process.env["NEKO_DISABLE_FFF"] === undefined
      ? process.platform === "win32"
      : truthy("NEKO_DISABLE_FFF"),
  NEKO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : (copy.toLowerCase() === "true" || copy === "1"),
  NEKO_EXPERIMENTAL_WORKSPACES: truthy("NEKO_EXPERIMENTAL_WORKSPACES"),
  NEKO_ROUTE: process.env["NEKO_ROUTE"],
  NEKO_FAST_BOOT: Boolean(process.env["NEKO_FAST_BOOT"]),
}
