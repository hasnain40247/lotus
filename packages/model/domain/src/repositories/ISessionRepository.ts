import { Context, Effect } from "effect"
import type { Session } from "@gco/schema"

export interface ListAnchor {
  cursor?: string
  limit?: number
}

export interface ISessionRepository {
  /** Return a single session by ID, or undefined if it does not exist. */
  get(id: Session.ID): Effect.Effect<Session.Info | undefined, Error>
  /** List sessions for a project, with optional cursor-based pagination. */
  list(projectID: string, anchor?: ListAnchor): Effect.Effect<Session.Info[], Error>
  /** Persist a new session record. */
  create(info: Session.Info): Effect.Effect<void, Error>
  /** Apply a partial update to an existing session. */
  update(id: Session.ID, patch: Partial<Session.Info>): Effect.Effect<void, Error>
  /** Soft-delete (archive) a session. */
  archive(id: Session.ID): Effect.Effect<void, Error>
}

export class SessionRepository extends Context.Service<SessionRepository, ISessionRepository>()("SessionRepository") {}
