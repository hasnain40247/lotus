export * from "./types"
export * from "./client"
export * as data from "./data"

import { createNekoClient } from "./client"
import type { NekoClientConfig } from "./client"

export async function createNeko(options?: NekoClientConfig) {
  const client = createNekoClient(options)
  return { client }
}
