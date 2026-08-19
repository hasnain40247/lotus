import { Layer } from "effect"

export { InMemorySessionRepositoryLive, layer as InMemorySessionRepositoryLayer } from "./InMemorySessionRepository"
export { InMemoryEventRepositoryLive, layer as InMemoryEventRepositoryLayer } from "./InMemoryEventRepository"
export { InMemoryPermissionRepositoryLive, layer as InMemoryPermissionRepositoryLayer } from "./InMemoryPermissionRepository"
export { InMemoryProjectRepositoryLive, layer as InMemoryProjectRepositoryLayer } from "./InMemoryProjectRepository"
export { InMemoryCredentialRepositoryLive, layer as InMemoryCredentialRepositoryLayer } from "./InMemoryCredentialRepository"

export { seedSession, makeEvent } from "./helpers"

import { InMemorySessionRepositoryLive } from "./InMemorySessionRepository"
import { InMemoryEventRepositoryLive } from "./InMemoryEventRepository"
import { InMemoryPermissionRepositoryLive } from "./InMemoryPermissionRepository"
import { InMemoryProjectRepositoryLive } from "./InMemoryProjectRepository"
import { InMemoryCredentialRepositoryLive } from "./InMemoryCredentialRepository"

/**
 * Combined test layer providing all in-memory repository implementations.
 * Provide this to any Effect program under test that depends on model repositories.
 *
 * Each repository gets its own private Map — the Maps are closed over inside
 * the Layer factories, so they are not shared between tests that create
 * fresh layer instances.
 */
export const TestModelLayer = Layer.mergeAll(
  InMemorySessionRepositoryLive,
  InMemoryEventRepositoryLive,
  InMemoryPermissionRepositoryLive,
  InMemoryProjectRepositoryLive,
  InMemoryCredentialRepositoryLive,
)
