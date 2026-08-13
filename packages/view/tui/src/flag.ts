function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["LOTUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]

export const Flag = {
  LOTUS_DISABLE_TERMINAL_TITLE: truthy("LOTUS_DISABLE_TERMINAL_TITLE"),
  LOTUS_SHOW_TTFD: truthy("LOTUS_SHOW_TTFD"),
  LOTUS_DISABLE_MOUSE: truthy("LOTUS_DISABLE_MOUSE"),
  LOTUS_DISABLE_FFF:
    process.env["LOTUS_DISABLE_FFF"] === undefined
      ? process.platform === "win32"
      : truthy("LOTUS_DISABLE_FFF"),
  LOTUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : (copy.toLowerCase() === "true" || copy === "1"),
  LOTUS_EXPERIMENTAL_WORKSPACES: truthy("LOTUS_EXPERIMENTAL_WORKSPACES"),
  LOTUS_ROUTE: process.env["LOTUS_ROUTE"],
  LOTUS_FAST_BOOT: Boolean(process.env["LOTUS_FAST_BOOT"]),
}
