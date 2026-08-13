import path from "path"
import os from "os"
import { mkdir } from "fs/promises"

const app = "lotus-code"

const xdgData = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
const xdgCache = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache")
const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config")
const xdgState = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state")

const data = path.join(xdgData, app)
const cache = path.join(xdgCache, app)
const config = path.join(xdgConfig, app)
const state = path.join(xdgState, app)
const tmp = path.join(os.tmpdir(), app)

export const Global = {
  Path: {
    get home() {
      return process.env.LOTUS_TEST_HOME ?? os.homedir()
    },
    data,
    bin: path.join(cache, "bin"),
    log: path.join(data, "log"),
    cache,
    config,
    state,
    tmp,
  },
}

// Ensure directories exist
await Promise.all([
  mkdir(data, { recursive: true }),
  mkdir(config, { recursive: true }),
  mkdir(state, { recursive: true }),
  mkdir(tmp, { recursive: true }),
  mkdir(path.join(cache, "bin"), { recursive: true }),
]).catch(() => {})

export const InstallationVersion = typeof (globalThis as any).LOTUS_VERSION === "string"
  ? (globalThis as any).LOTUS_VERSION
  : typeof (globalThis as any).LOTUS_VERSION === "string"
  ? (globalThis as any).LOTUS_VERSION
  : "local"
