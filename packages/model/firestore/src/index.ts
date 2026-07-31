import { Layer } from "effect"
import { FirestoreClient, GoogleIdentity } from "@gco/infra-gcp"
import {
  SessionRepository,
  EventRepository,
  PermissionRepository,
  ProjectRepository,
  WorkspaceRepository,
  CredentialRepository,
} from "@gco/model-domain"

export { FirestoreSessionRepositoryLive } from "./FirestoreSessionRepository"
export { FirestoreEventRepositoryLive } from "./FirestoreEventRepository"
export { FirestorePermissionRepositoryLive } from "./FirestorePermissionRepository"
export { FirestoreProjectRepositoryLive } from "./FirestoreProjectRepository"
export { FirestoreWorkspaceRepositoryLive } from "./FirestoreWorkspaceRepository"
export { FirestoreCredentialRepositoryLive } from "./FirestoreCredentialRepository"

// Re-export the repository tags for convenience
export {
  SessionRepository,
  EventRepository,
  PermissionRepository,
  ProjectRepository,
  WorkspaceRepository,
  CredentialRepository,
}

import { FirestoreSessionRepositoryLive } from "./FirestoreSessionRepository"
import { FirestoreEventRepositoryLive } from "./FirestoreEventRepository"
import { FirestorePermissionRepositoryLive } from "./FirestorePermissionRepository"
import { FirestoreProjectRepositoryLive } from "./FirestoreProjectRepository"
import { FirestoreWorkspaceRepositoryLive } from "./FirestoreWorkspaceRepository"
import { FirestoreCredentialRepositoryLive } from "./FirestoreCredentialRepository"

/**
 * Combined layer that wires all Firestore repository implementations.
 *
 * Requires `FirestoreClient` in the environment (provided by `@gco/infra-gcp`).
 * Provides all repository tags from `@gco/model-domain`.
 *
 * Usage:
 * ```ts
 * const AppLayer = FirestoreModelLayer.pipe(
 *   Layer.provide(FirestoreClient.layer),
 *   Layer.provide(GcpConfig.layer),
 * )
 * ```
 */
export const FirestoreModelLayer: Layer.Layer<
  | SessionRepository
  | EventRepository
  | PermissionRepository
  | ProjectRepository
  | WorkspaceRepository
  | CredentialRepository,
  never,
  FirestoreClient | GoogleIdentity
> = Layer.mergeAll(
  FirestoreSessionRepositoryLive,
  FirestoreEventRepositoryLive,
  FirestorePermissionRepositoryLive,
  FirestoreProjectRepositoryLive,
  FirestoreWorkspaceRepositoryLive,
  FirestoreCredentialRepositoryLive,
)
