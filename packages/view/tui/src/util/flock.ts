import path from "path"
import os from "os"
import { mkdir, readFile, rm, stat, writeFile } from "fs/promises"

const state = path.join(
  process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
  "gcloud-opencode",
)

export namespace Flock {
  const locks = new Map<string, Promise<void>>()

  export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Simple in-process lock using a promise queue
    let resolve!: () => void
    const lock = new Promise<void>((r) => (resolve = r))
    const current = locks.get(key) ?? Promise.resolve()
    locks.set(key, current.then(() => lock))

    await current
    try {
      return await fn()
    } finally {
      resolve()
      if (locks.get(key) === lock) locks.delete(key)
    }
  }
}
