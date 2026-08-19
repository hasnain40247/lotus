import type { Database } from "bun:sqlite"
import { Effect, Layer, Schema } from "effect"
import {
  CredentialRepository,
  type ICredentialRepository,
  type CredentialInfo,
} from "@gco/model-domain"
import { Credential, Integration } from "@gco/schema"
import { SqliteDb } from "./db"

const decodeValueSync = Schema.decodeUnknownSync(Credential.Value)
const encodeValueSync = Schema.encodeSync(Credential.Value)

interface CredentialRow {
  id: string
  integrationID: string
  label: string
  data: string
}

function toInfo(row: CredentialRow): CredentialInfo {
  const value = decodeValueSync(JSON.parse(row.data))
  return {
    id: row.id as Credential.ID,
    integrationID: row.integrationID as Integration.ID,
    label: row.label,
    value,
  }
}

class SqliteCredentialRepositoryImpl implements ICredentialRepository {
  constructor(private readonly db: Database) {}

  all(): Effect.Effect<CredentialInfo[], Error> {
    return Effect.try({
      try: () => {
        const rows = this.db
          .query("SELECT id, integrationID, label, data FROM credentials")
          .all() as CredentialRow[]
        return rows.map(toInfo)
      },
      catch: (e) => new Error(`SqliteCredentialRepository.all failed: ${e}`),
    })
  }

  list(integrationID: Integration.ID): Effect.Effect<CredentialInfo[], Error> {
    return Effect.try({
      try: () => {
        const rows = this.db
          .query(
            "SELECT id, integrationID, label, data FROM credentials WHERE integrationID = ?",
          )
          .all(integrationID as string) as CredentialRow[]
        return rows.map(toInfo)
      },
      catch: (e) => new Error(`SqliteCredentialRepository.list failed: ${e}`),
    })
  }

  get(id: Credential.ID): Effect.Effect<CredentialInfo | undefined, Error> {
    return Effect.try({
      try: () => {
        const row = this.db
          .query(
            "SELECT id, integrationID, label, data FROM credentials WHERE id = ?",
          )
          .get(id as string) as CredentialRow | null
        return row ? toInfo(row) : undefined
      },
      catch: (e) => new Error(`SqliteCredentialRepository.get failed: ${e}`),
    })
  }

  create(input: {
    readonly integrationID: Integration.ID
    readonly value: Credential.Value
    readonly label?: string
  }): Effect.Effect<CredentialInfo, Error> {
    return Effect.try({
      try: () => {
        const id = Credential.ID.create()
        const label = input.label ?? ""
        const encoded = encodeValueSync(input.value)
        const now = Date.now()
        this.db
          .query(
            `INSERT INTO credentials (id, integrationID, label, data, time_created, time_updated)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id as string,
            input.integrationID as string,
            label,
            JSON.stringify(encoded),
            now,
            now,
          )
        return {
          id,
          integrationID: input.integrationID,
          label,
          value: input.value,
        }
      },
      catch: (e) => new Error(`SqliteCredentialRepository.create failed: ${e}`),
    })
  }

  update(
    id: Credential.ID,
    updates: Partial<Pick<CredentialInfo, "label" | "value">>,
  ): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        if (updates.label === undefined && updates.value === undefined) return
        const now = Date.now()
        if (updates.value !== undefined && updates.label !== undefined) {
          this.db
            .query(
              `UPDATE credentials SET label = ?, data = ?, time_updated = ? WHERE id = ?`,
            )
            .run(
              updates.label,
              JSON.stringify(encodeValueSync(updates.value)),
              now,
              id as string,
            )
        } else if (updates.value !== undefined) {
          this.db
            .query(`UPDATE credentials SET data = ?, time_updated = ? WHERE id = ?`)
            .run(
              JSON.stringify(encodeValueSync(updates.value)),
              now,
              id as string,
            )
        } else if (updates.label !== undefined) {
          this.db
            .query(`UPDATE credentials SET label = ?, time_updated = ? WHERE id = ?`)
            .run(updates.label, now, id as string)
        }
      },
      catch: (e) => new Error(`SqliteCredentialRepository.update failed: ${e}`),
    })
  }

  remove(id: Credential.ID): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        this.db.query("DELETE FROM credentials WHERE id = ?").run(id as string)
      },
      catch: (e) => new Error(`SqliteCredentialRepository.remove failed: ${e}`),
    })
  }
}

export const SqliteCredentialRepositoryLive: Layer.Layer<
  CredentialRepository,
  never,
  SqliteDb
> = Layer.effect(
  CredentialRepository,
  Effect.gen(function* () {
    const { db } = yield* SqliteDb
    return new SqliteCredentialRepositoryImpl(db)
  }),
)
