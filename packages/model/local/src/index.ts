import { Layer } from "effect"
import {
  SessionRepository,
  EventRepository,
  ProjectRepository,
  PermissionRepository,
  CredentialRepository,
} from "@gco/model-domain"
import { SqliteDb } from "./db"
import { SqliteSessionRepositoryLive } from "./SqliteSessionRepository"
import { SqliteProjectRepositoryLive } from "./SqliteProjectRepository"
import { SqlitePermissionRepositoryLive } from "./SqlitePermissionRepository"
import { SqliteCredentialRepositoryLive } from "./SqliteCredentialRepository"
import { JsonEventRepositoryLive } from "./JsonEventRepository"

export { SqliteDb } from "./db"
export { SqliteSessionRepositoryLive } from "./SqliteSessionRepository"
export { SqliteProjectRepositoryLive } from "./SqliteProjectRepository"
export { SqlitePermissionRepositoryLive } from "./SqlitePermissionRepository"
export { SqliteCredentialRepositoryLive } from "./SqliteCredentialRepository"
export { JsonEventRepositoryLive } from "./JsonEventRepository"
export { dataRoot, dbPath, eventsRoot, sessionEventsDir } from "./paths"

export {
  SessionRepository,
  EventRepository,
  ProjectRepository,
  PermissionRepository,
  CredentialRepository,
}

/**
 * Combined local model layer — SQLite for session/project/permission
 * metadata + JSON files for the event stream. Requires no ambient config;
 * the DB path is resolved from `$XDG_DATA_HOME` (defaults to `~/.local/share/neko`).
 */
export const LocalModelLayer: Layer.Layer<
  | SessionRepository
  | EventRepository
  | ProjectRepository
  | PermissionRepository
  | CredentialRepository
> = Layer.mergeAll(
  SqliteSessionRepositoryLive,
  SqliteProjectRepositoryLive,
  SqlitePermissionRepositoryLive,
  SqliteCredentialRepositoryLive,
  JsonEventRepositoryLive,
).pipe(Layer.provide(SqliteDb.layer))
