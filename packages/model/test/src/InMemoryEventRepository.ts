import { Effect, Layer } from "effect"
import { EventRepository } from "@gco/model-domain"
import type { SessionEvent } from "@gco/model-domain"

export const InMemoryEventRepositoryLive = Layer.succeed(EventRepository, (() => {
  const store = new Map<string, SessionEvent.DurableEvent[]>()
  const seqCounters = new Map<string, number>()
  const compactionSeqs = new Map<string, number>()

  function getEvents(aggregateID: string): SessionEvent.DurableEvent[] {
    let events = store.get(aggregateID)
    if (!events) {
      events = []
      store.set(aggregateID, events)
    }
    return events
  }

  function nextSeq(aggregateID: string): number {
    const current = seqCounters.get(aggregateID) ?? 0
    const next = current + 1
    seqCounters.set(aggregateID, next)
    return next
  }

  return {
    append(aggregateID: string, events: SessionEvent.DurableEvent[]): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        if (events.length === 0) return

        const stored = getEvents(aggregateID)

        for (const event of events) {
          const seq = nextSeq(aggregateID)
          const durableWithSeq: SessionEvent.DurableEvent = {
            ...event,
            durable: event.durable
              ? { ...event.durable, aggregateID, seq }
              : { aggregateID, seq, version: 1 },
          }
          stored.push(durableWithSeq)

          // Track the latest compaction boundary if this is a Compaction.Ended event
          if (event.type === "session.next.compaction.ended") {
            compactionSeqs.set(aggregateID, seq)
          }
        }
      })
    },

    load(aggregateID: string, fromSeq?: number): Effect.Effect<SessionEvent.DurableEvent[], Error> {
      return Effect.sync(() => {
        const stored = getEvents(aggregateID)
        if (fromSeq === undefined) {
          return [...stored]
        }
        return stored.filter((e) => (e.durable?.seq ?? 0) > fromSeq)
      })
    },

    loadFromCompaction(aggregateID: string): Effect.Effect<SessionEvent.DurableEvent[], Error> {
      return Effect.sync(() => {
        const stored = getEvents(aggregateID)
        const lastCompactionSeq = compactionSeqs.get(aggregateID) ?? 0

        if (lastCompactionSeq === 0) {
          return [...stored]
        }

        // Return events from the compaction boundary forward (exclusive of events before it)
        return stored.filter((e) => (e.durable?.seq ?? 0) >= lastCompactionSeq)
      })
    },
  }
})())

export const layer = InMemoryEventRepositoryLive
