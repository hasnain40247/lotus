import { Context, Effect } from "effect"
import type { SessionEvent } from "@gco/schema"

/**
 * Durable event store for session event sourcing.
 *
 * Only durable events (those with an `aggregate` key in their definition)
 * are written here. Live-only stream fragments (Text.Delta, Reasoning.Delta,
 * Compaction.Delta, Tool.Input.Delta) are never persisted.
 */
export interface IEventRepository {
  /**
   * Append one or more durable events to an aggregate's event log.
   * Implementations must assign monotonically increasing sequence numbers.
   */
  append(aggregateID: string, events: SessionEvent.DurableEvent[]): Effect.Effect<void, Error>

  /**
   * Load all durable events for an aggregate, optionally starting after a
   * given sequence number (exclusive).
   */
  load(aggregateID: string, fromSeq?: number): Effect.Effect<SessionEvent.DurableEvent[], Error>

  /**
   * Load events from the last compaction boundary forward.
   * If no compaction has occurred, returns the full event log.
   */
  loadFromCompaction(aggregateID: string): Effect.Effect<SessionEvent.DurableEvent[], Error>
}

export class EventRepository extends Context.Service<EventRepository, IEventRepository>()("EventRepository") {}
