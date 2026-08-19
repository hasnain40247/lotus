import type { Database } from "bun:sqlite"
import { DateTime, Effect, Layer, Schema } from "effect"
import {
  SessionRepository,
  type ISessionRepository,
  type ListAnchor,
} from "@gco/model-domain"
import { Session } from "@gco/schema"
import { SqliteDb } from "./db"

const decodeSessionSync = Schema.decodeUnknownSync(Session.Info)
const encodeSessionSync = Schema.encodeSync(Session.Info)

/**
 * Encode a `Partial<Session.Info>` into the on-wire shape (with DateTime →
 * epoch-millis) so it can be merged into the stored JSON.
 */
function encodeSessionPatch(patch: Partial<Session.Info>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (key === "time" && value !== null && typeof value === "object") {
      const t = value as Session.Info["time"]
      const encoded: Record<string, unknown> = {}
      if (t.created !== undefined) encoded["created"] = DateTime.toEpochMillis(t.created)
      if (t.updated !== undefined) encoded["updated"] = DateTime.toEpochMillis(t.updated)
      if (t.archived !== undefined) encoded["archived"] = DateTime.toEpochMillis(t.archived)
      out["time"] = encoded
    } else {
      out[key] = value
    }
  }
  return out
}

/**
 * Deep-merge two encoded (JSON-shape) session objects. Only special-cases
 * the two known nested structs; everything else uses shallow overwrite.
 */
function mergeEncoded(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (
      (key === "time" || key === "tokens" || key === "location") &&
      value !== null &&
      typeof value === "object" &&
      typeof merged[key] === "object" &&
      merged[key] !== null
    ) {
      merged[key] = { ...(merged[key] as object), ...(value as object) }
    } else {
      merged[key] = value
    }
  }
  return merged
}

class SqliteSessionRepositoryImpl implements ISessionRepository {
  constructor(private readonly db: Database) {}

  get(id: Session.ID): Effect.Effect<Session.Info | undefined, Error> {
    return Effect.try({
      try: () => {
        const row = this.db
          .query("SELECT data FROM sessions WHERE id = ?")
          .get(id as string) as { data: string } | null
        if (!row) return undefined
        return decodeSessionSync(JSON.parse(row.data))
      },
      catch: (e) => new Error(`SqliteSessionRepository.get failed: ${e}`),
    })
  }

  list(
    projectID: string,
    anchor?: ListAnchor,
  ): Effect.Effect<Session.Info[], Error> {
    return Effect.try({
      try: () => {
        const rows = this.db
          .query(
            `SELECT data FROM sessions
             WHERE projectID = ? AND time_archived IS NULL
             ORDER BY time_created DESC`,
          )
          .all(projectID) as Array<{ data: string }>

        let items = rows.map((r) => decodeSessionSync(JSON.parse(r.data)))

        // Preserve current Firestore behavior: cursor is an ID; skip past it.
        if (anchor?.cursor) {
          const idx = items.findIndex((s) => (s.id as string) === anchor.cursor)
          if (idx !== -1) items = items.slice(idx + 1)
        }
        if (anchor?.limit) items = items.slice(0, anchor.limit)

        return items
      },
      catch: (e) => new Error(`SqliteSessionRepository.list failed: ${e}`),
    })
  }

  create(info: Session.Info): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        const encoded = encodeSessionSync(info) as Record<string, unknown> & {
          projectID: string
          time: { created: number; archived?: number }
        }
        this.db
          .query(
            `INSERT INTO sessions (id, projectID, time_created, time_archived, eventSeq, lastCompactionSeq, data)
             VALUES (?, ?, ?, ?, 0, NULL, ?)`,
          )
          .run(
            info.id as string,
            encoded.projectID,
            encoded.time.created,
            encoded.time.archived ?? null,
            JSON.stringify(encoded),
          )
      },
      catch: (e) => new Error(`SqliteSessionRepository.create failed: ${e}`),
    })
  }

  update(id: Session.ID, patch: Partial<Session.Info>): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        const row = this.db
          .query("SELECT data FROM sessions WHERE id = ?")
          .get(id as string) as { data: string } | null
        if (!row) throw new Error(`Session not found: ${id}`)

        const current = JSON.parse(row.data) as Record<string, unknown>
        const encodedPatch = encodeSessionPatch(patch)
        const merged = mergeEncoded(current, encodedPatch)

        const projectID = String(merged["projectID"] ?? "")
        const time = (merged["time"] ?? {}) as { created?: number; archived?: number }
        this.db
          .query(
            `UPDATE sessions
             SET data = ?, projectID = ?, time_created = ?, time_archived = ?
             WHERE id = ?`,
          )
          .run(
            JSON.stringify(merged),
            projectID,
            time.created ?? 0,
            time.archived ?? null,
            id as string,
          )
      },
      catch: (e) => new Error(`SqliteSessionRepository.update failed: ${e}`),
    })
  }

  archive(id: Session.ID): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        const now = Date.now()
        const patched = this.db
          .query(
            `UPDATE sessions
             SET time_archived = ?,
                 data = json_set(data, '$.time.archived', ?)
             WHERE id = ?`,
          )
          .run(now, now, id as string)
        if (patched.changes === 0) throw new Error(`Session not found: ${id}`)
      },
      catch: (e) => new Error(`SqliteSessionRepository.archive failed: ${e}`),
    })
  }
}

export const SqliteSessionRepositoryLive: Layer.Layer<
  SessionRepository,
  never,
  SqliteDb
> = Layer.effect(
  SessionRepository,
  Effect.gen(function* () {
    const { db } = yield* SqliteDb
    return new SqliteSessionRepositoryImpl(db)
  }),
)
