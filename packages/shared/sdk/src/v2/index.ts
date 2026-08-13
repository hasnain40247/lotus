export * from "./types"
export * from "./client"
export * as data from "./data"

import { createLotusCodeClient } from "./client"
import type { LotusCodeClientConfig } from "./client"

export async function createLotusCode(options?: LotusCodeClientConfig) {
  const client = createLotusCodeClient(options)
  return { client }
}
