import * as os from "node:os"
import * as path from "node:path"

/**
 * Resolve the on-disk root for neko's persistent state.
 *
 * Honors `$XDG_DATA_HOME` when set (works on any OS Bun runs on).
 * Defaults to `~/.local/share/neko` — matches opencode's convention.
 */
export function dataRoot(): string {
  const xdg = process.env.XDG_DATA_HOME
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".local", "share")
  return path.join(base, "neko")
}

export function dbPath(): string {
  return path.join(dataRoot(), "neko.db")
}

export function eventsRoot(): string {
  return path.join(dataRoot(), "events")
}

export function sessionEventsDir(sessionID: string): string {
  return path.join(eventsRoot(), sessionID)
}
