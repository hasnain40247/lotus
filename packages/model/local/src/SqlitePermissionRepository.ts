import type { Database } from "bun:sqlite"
import { Effect, Layer, Schema } from "effect"
import {
  PermissionRepository,
  type IPermissionRepository,
} from "@gco/model-domain"
import { PermissionSaved } from "@gco/schema"
import { SqliteDb } from "./db"

const decodePermissionSync = Schema.decodeUnknownSync(PermissionSaved.Info)
const encodePermissionSync = Schema.encodeSync(PermissionSaved.Info)

class SqlitePermissionRepositoryImpl implements IPermissionRepository {
  constructor(private readonly db: Database) {}

  list(): Effect.Effect<PermissionSaved.Info[], Error> {
    return Effect.try({
      try: () => {
        const rows = this.db
          .query("SELECT data FROM permissions")
          .all() as Array<{ data: string }>
        return rows.map((r) => decodePermissionSync(JSON.parse(r.data)))
      },
      catch: (e) => new Error(`SqlitePermissionRepository.list failed: ${e}`),
    })
  }

  listForProject(
    projectID: string,
  ): Effect.Effect<PermissionSaved.Info[], Error> {
    return Effect.try({
      try: () => {
        const rows = this.db
          .query("SELECT data FROM permissions WHERE projectID = ?")
          .all(projectID) as Array<{ data: string }>
        return rows.map((r) => decodePermissionSync(JSON.parse(r.data)))
      },
      catch: (e) =>
        new Error(`SqlitePermissionRepository.listForProject failed: ${e}`),
    })
  }

  save(info: PermissionSaved.Info): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        const encoded = encodePermissionSync(info) as Record<string, unknown> & {
          projectID: string
        }
        // Upsert: replace if id already exists.
        this.db
          .query(
            `INSERT INTO permissions (id, projectID, data) VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET projectID = excluded.projectID, data = excluded.data`,
          )
          .run(info.id as string, encoded.projectID, JSON.stringify(encoded))
      },
      catch: (e) => new Error(`SqlitePermissionRepository.save failed: ${e}`),
    })
  }

  remove(id: PermissionSaved.ID): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        this.db
          .query("DELETE FROM permissions WHERE id = ?")
          .run(id as string)
      },
      catch: (e) => new Error(`SqlitePermissionRepository.remove failed: ${e}`),
    })
  }

  removeAllForProject(projectID: string): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        this.db
          .query("DELETE FROM permissions WHERE projectID = ?")
          .run(projectID)
      },
      catch: (e) =>
        new Error(
          `SqlitePermissionRepository.removeAllForProject failed: ${e}`,
        ),
    })
  }
}

export const SqlitePermissionRepositoryLive: Layer.Layer<
  PermissionRepository,
  never,
  SqliteDb
> = Layer.effect(
  PermissionRepository,
  Effect.gen(function* () {
    const { db } = yield* SqliteDb
    return new SqlitePermissionRepositoryImpl(db)
  }),
)
