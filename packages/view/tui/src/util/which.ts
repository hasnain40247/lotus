import whichPkg from "which"
import path from "path"
import os from "os"

// Local bin directory for neko binaries
const localBin = path.join(os.homedir(), ".local", "share", "neko", "bin")

export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const base = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? ""
  const full = base ? base + path.delimiter + localBin : localBin
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: full,
    pathExt: env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt,
  })
  return typeof result === "string" ? result : null
}
