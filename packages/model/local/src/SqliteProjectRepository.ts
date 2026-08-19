import type { Database } from "bun:sqlite"
import { Effect, Layer, Schema } from "effect"
import {
  ProjectRepository,
  type IProjectRepository,
} from "@gco/model-domain"
import { Project } from "@gco/schema"
import { SqliteDb } from "./db"

const decodeProjectSync = Schema.decodeUnknownSync(Project.Info)
const encodeProjectSync = Schema.encodeSync(Project.Info)

class SqliteProjectRepositoryImpl implements IProjectRepository {
  constructor(private readonly db: Database) {}

  get(id: Project.ID): Effect.Effect<Project.Info | undefined, Error> {
    return Effect.try({
      try: () => {
        const row = this.db
          .query("SELECT data FROM projects WHERE id = ?")
          .get(id as string) as { data: string } | null
        return row ? decodeProjectSync(JSON.parse(row.data)) : undefined
      },
      catch: (e) => new Error(`SqliteProjectRepository.get failed: ${e}`),
    })
  }

  getByWorktree(worktree: string): Effect.Effect<Project.Info | undefined, Error> {
    return Effect.try({
      try: () => {
        const row = this.db
          .query("SELECT data FROM projects WHERE worktree = ? LIMIT 1")
          .get(worktree) as { data: string } | null
        return row ? decodeProjectSync(JSON.parse(row.data)) : undefined
      },
      catch: (e) =>
        new Error(`SqliteProjectRepository.getByWorktree failed: ${e}`),
    })
  }

  list(): Effect.Effect<Project.Info[], Error> {
    return Effect.try({
      try: () => {
        const rows = this.db
          .query("SELECT data FROM projects")
          .all() as Array<{ data: string }>
        return rows.map((r) => decodeProjectSync(JSON.parse(r.data)))
      },
      catch: (e) => new Error(`SqliteProjectRepository.list failed: ${e}`),
    })
  }

  create(info: Project.Info): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        const encoded = encodeProjectSync(info) as Record<string, unknown> & {
          worktree: string
        }
        // Idempotent — if a row for the same id exists, skip.
        this.db
          .query(
            `INSERT OR IGNORE INTO projects (id, worktree, data)
             VALUES (?, ?, ?)`,
          )
          .run(info.id as string, encoded.worktree, JSON.stringify(encoded))
      },
      catch: (e) => new Error(`SqliteProjectRepository.create failed: ${e}`),
    })
  }

  update(
    id: Project.ID,
    patch: Partial<Project.Info>,
  ): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        const row = this.db
          .query("SELECT data FROM projects WHERE id = ?")
          .get(id as string) as { data: string } | null
        if (!row) throw new Error(`Project not found: ${id}`)

        const current = JSON.parse(row.data) as Record<string, unknown>
        // Shallow merge — Project.Info doesn't nest DateTime values, so a
        // plain patch (already in encoded shape when written by callers) is
        // safe to overlay.
        const merged = { ...current, ...(patch as Record<string, unknown>) }
        const worktree = String(merged["worktree"] ?? "")
        this.db
          .query(
            `UPDATE projects SET data = ?, worktree = ? WHERE id = ?`,
          )
          .run(JSON.stringify(merged), worktree, id as string)
      },
      catch: (e) => new Error(`SqliteProjectRepository.update failed: ${e}`),
    })
  }
}

export const SqliteProjectRepositoryLive: Layer.Layer<
  ProjectRepository,
  never,
  SqliteDb
> = Layer.effect(
  ProjectRepository,
  Effect.gen(function* () {
    const { db } = yield* SqliteDb
    return new SqliteProjectRepositoryImpl(db)
  }),
)
