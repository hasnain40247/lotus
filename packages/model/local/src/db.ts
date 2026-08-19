import { Database } from "bun:sqlite"
import * as fs from "node:fs"
import { Context, Effect, Layer } from "effect"
import { dataRoot, dbPath, eventsRoot } from "./paths"

export interface SqliteDbShape {
  readonly db: Database
}

export class SqliteDb extends Context.Service<SqliteDb, SqliteDbShape>()(
  "@gco/model-local/SqliteDb",
) {
  static readonly layer: Layer.Layer<SqliteDb> = Layer.effect(
    SqliteDb,
    Effect.sync(() => {
      fs.mkdirSync(dataRoot(), { recursive: true })
      fs.mkdirSync(eventsRoot(), { recursive: true })
      const db = new Database(dbPath(), { create: true })
      db.exec("PRAGMA journal_mode = WAL;")
      db.exec("PRAGMA foreign_keys = ON;")
      runMigrations(db)
      return { db }
    }),
  )
}

// ── Migrations ───────────────────────────────────────────────────────────────

interface Migration {
  readonly id: number
  readonly up: (db: Database) => void
}

const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE sessions (
          id                 TEXT PRIMARY KEY,
          projectID          TEXT NOT NULL,
          time_created       INTEGER NOT NULL,
          time_archived      INTEGER,
          eventSeq           INTEGER NOT NULL DEFAULT 0,
          lastCompactionSeq  INTEGER,
          data               TEXT NOT NULL
        );
        CREATE INDEX idx_sessions_project_created
          ON sessions (projectID, time_created DESC);

        CREATE TABLE projects (
          id            TEXT PRIMARY KEY,
          worktree      TEXT NOT NULL UNIQUE,
          data          TEXT NOT NULL
        );

        CREATE TABLE permissions (
          id         TEXT PRIMARY KEY,
          projectID  TEXT NOT NULL,
          data       TEXT NOT NULL
        );
        CREATE INDEX idx_permissions_project ON permissions (projectID);

        CREATE TABLE meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)
    },
  },
  {
    id: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE credentials (
          id             TEXT PRIMARY KEY,
          integrationID  TEXT NOT NULL,
          label          TEXT NOT NULL,
          data           TEXT NOT NULL,
          time_created   INTEGER NOT NULL,
          time_updated   INTEGER NOT NULL
        );
        CREATE INDEX idx_credentials_integration ON credentials (integrationID);
      `)
    },
  },
]

function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `)
  const applied = new Set<number>(
    (db.query("SELECT id FROM schema_migrations").all() as Array<{ id: number }>).map(
      (r) => r.id,
    ),
  )

  const insertApplied = db.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
  )
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    db.transaction(() => {
      m.up(db)
      insertApplied.run(m.id, Date.now())
    })()
  }
}
