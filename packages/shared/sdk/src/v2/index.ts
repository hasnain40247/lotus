export * from "./types"
export * from "./client"
export * as data from "./data"

import { createOpencodeClient } from "./client"
import type { OpencodeClientConfig } from "./client"

export async function createOpencode(options?: OpencodeClientConfig) {
  const client = createOpencodeClient(options)
  return { client }
}
