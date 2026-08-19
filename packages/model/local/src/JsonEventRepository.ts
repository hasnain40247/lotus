import type { Database } from "bun:sqlite"
import * as fs from "node:fs"
import * as path from "node:path"
import { Effect, Layer, Schema } from "effect"
import {
  EventRepository,
  type IEventRepository,
} from "@gco/model-domain"
import { SessionEvent } from "@gco/schema"
import { SqliteDb } from "./db"
import { eventsRoot, sessionEventsDir } from "./paths"

const decodeDurableSync = Schema.decodeUnknownSync(SessionEvent.Durable)
const encodeDurableSync = Schema.encodeSync(SessionEvent.Durable)

const SEQ_PAD = 20

function seqToFilename(seq: number): string {
  return String(seq).padStart(SEQ_PAD, "0") + ".json"
}

function filenameToSeq(name: string): number | undefined {
  const stem = name.endsWith(".json") ? name.slice(0, -5) : name
  const n = Number.parseInt(stem, 10)
  return Number.isFinite(n) ? n : undefined
}

class JsonEventRepositoryImpl implements IEventRepository {
  /** Per-session cached `max(seq)` for cheap append. */
  private readonly maxSeqCache = new Map<string, number>()

  constructor(private readonly db: Database) {
    fs.mkdirSync(eventsRoot(), { recursive: true })
  }

  private currentMaxSeq(sessionID: string): number {
    const cached = this.maxSeqCache.get(sessionID)
    if (cached !== undefined) return cached

    const dir = sessionEventsDir(sessionID)
    let max = 0
    try {
      for (const name of fs.readdirSync(dir)) {
        const seq = filenameToSeq(name)
        if (seq !== undefined && seq > max) max = seq
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code !== "ENOENT") throw err
    }
    this.maxSeqCache.set(sessionID, max)
    return max
  }

  append(
    aggregateID: string,
    events: SessionEvent.DurableEvent[],
  ): Effect.Effect<void, Error> {
    if (events.length === 0) return Effect.void
    return Effect.try({
      try: () => {
        const dir = sessionEventsDir(aggregateID)
        fs.mkdirSync(dir, { recursive: true })

        let seq = this.currentMaxSeq(aggregateID)
        let lastCompactionSeq: number | undefined

        for (const event of events) {
          seq += 1
          const encoded = encodeDurableSync(event) as {
            type: string
            [k: string]: unknown
          }
          const filePath = path.join(dir, seqToFilename(seq))
          fs.writeFileSync(filePath, JSON.stringify(encoded))
          if (encoded.type === "session.next.compaction.ended") {
            lastCompactionSeq = seq
          }
        }

        this.maxSeqCache.set(aggregateID, seq)

        // Advisory DB update — the filesystem is the source of truth for the
        // event stream. This just keeps `sessions.eventSeq` current for cheap
        // list queries and preserves `lastCompactionSeq` for loadFromCompaction.
        if (lastCompactionSeq !== undefined) {
          this.db
            .query(
              `UPDATE sessions SET eventSeq = ?, lastCompactionSeq = ? WHERE id = ?`,
            )
            .run(seq, lastCompactionSeq, aggregateID)
        } else {
          this.db
            .query(`UPDATE sessions SET eventSeq = ? WHERE id = ?`)
            .run(seq, aggregateID)
        }
      },
      catch: (e) => new Error(`JsonEventRepository.append failed: ${e}`),
    })
  }

  load(
    aggregateID: string,
    fromSeq?: number,
  ): Effect.Effect<SessionEvent.DurableEvent[], Error> {
    return Effect.try({
      try: () => {
        const dir = sessionEventsDir(aggregateID)
        let names: string[]
        try {
          names = fs.readdirSync(dir)
        } catch (e) {
          const err = e as NodeJS.ErrnoException
          if (err.code === "ENOENT") return []
          throw err
        }
        names.sort() // zero-padded filenames sort correctly lexicographically

        const out: SessionEvent.DurableEvent[] = []
        for (const name of names) {
          const seq = filenameToSeq(name)
          if (seq === undefined) continue
          if (fromSeq !== undefined && seq <= fromSeq) continue
          const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"))
          out.push(decodeDurableSync(raw))
        }
        return out
      },
      catch: (e) => new Error(`JsonEventRepository.load failed: ${e}`),
    })
  }

  loadFromCompaction(
    aggregateID: string,
  ): Effect.Effect<SessionEvent.DurableEvent[], Error> {
    const self = this
    return Effect.gen(function* () {
      const row = yield* Effect.try({
        try: () =>
          self.db
            .query("SELECT lastCompactionSeq FROM sessions WHERE id = ?")
            .get(aggregateID) as { lastCompactionSeq: number | null } | null,
        catch: (e) =>
          new Error(
            `JsonEventRepository.loadFromCompaction session read failed: ${e}`,
          ),
      })
      const last = row?.lastCompactionSeq ?? 0
      return yield* self.load(aggregateID, last > 0 ? last - 1 : undefined)
    })
  }
}

export const JsonEventRepositoryLive: Layer.Layer<
  EventRepository,
  never,
  SqliteDb
> = Layer.effect(
  EventRepository,
  Effect.gen(function* () {
    const { db } = yield* SqliteDb
    return new JsonEventRepositoryImpl(db)
  }),
)
