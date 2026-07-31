import { Effect, Layer, Schema } from "effect"
import type { Firestore } from "@google-cloud/firestore"
import { FirestoreClient } from "@gco/infra-gcp"
import {
  EventRepository,
  type IEventRepository,
} from "@gco/model-domain"
import { SessionEvent } from "@gco/schema"

/** Wire representation stored in each event document. */
interface StoredEvent {
  seq: number
  type: string
  data: Record<string, unknown>
}

const decodeDurableSync = Schema.decodeUnknownSync(SessionEvent.Durable)
const encodeDurableSync = Schema.encodeSync(SessionEvent.Durable)

function decodeStoredEvent(
  stored: StoredEvent,
): Effect.Effect<SessionEvent.DurableEvent, Error> {
  // Reconstitute the full tagged-union shape the codec expects
  const raw = { type: stored.type, ...stored.data }
  return Effect.try({
    try: () => decodeDurableSync(raw),
    catch: (e) => new Error(`FirestoreEventRepository decode failed: ${e}`),
  })
}

class FirestoreEventRepositoryImpl implements IEventRepository {
  constructor(private readonly db: Firestore) {}

  /**
   * Append events atomically.
   *
   * Strategy:
   *  1. Run a Firestore transaction that reads the current `eventSeq` on the
   *     session document.
   *  2. Build a WriteBatch inside the transaction to write all event documents
   *     into the `/sessions/{id}/events/` subcollection with monotonically
   *     increasing sequence numbers.
   *  3. Update `eventSeq` on the session document.
   *
   * Note: Firestore transactions allow at most 500 writes; large batches
   * should be split by callers if necessary.
   */
  append(
    aggregateID: string,
    events: SessionEvent.DurableEvent[],
  ): Effect.Effect<void, Error> {
    if (events.length === 0) return Effect.void

    return Effect.forEach(events, (event) =>
      Effect.try({
        try: () => encodeDurableSync(event),
        catch: (e) => new Error(`FirestoreEventRepository encode failed: ${e}`),
      }),
    ).pipe(
      Effect.flatMap((encodedEvents) =>
        Effect.tryPromise({
          try: () =>
            this.db.runTransaction(async (tx) => {
              const sessionRef = this.db.collection("sessions").doc(aggregateID)
              const sessionSnap = await tx.get(sessionRef)

              const currentSeq: number =
                (sessionSnap.data()?.["eventSeq"] as number | undefined) ?? 0

              const eventsRef = sessionRef.collection("events")

              let seq = currentSeq
              for (const encoded of encodedEvents) {
                seq += 1
                const { type, ...data } = encoded as { type: string } & Record<string, unknown>
                const storedEvent: StoredEvent = {
                  seq,
                  type,
                  data: data as Record<string, unknown>,
                }
                // Use seq as doc ID (zero-padded for lexicographic ordering)
                const docID = String(seq).padStart(20, "0")
                tx.set(eventsRef.doc(docID), storedEvent)
              }

              tx.update(sessionRef, { eventSeq: seq })
            }),
          catch: (e) =>
            new Error(`FirestoreEventRepository.append failed: ${e}`),
        }),
      ),
      Effect.asVoid,
    )
  }

  load(
    aggregateID: string,
    fromSeq?: number,
  ): Effect.Effect<SessionEvent.DurableEvent[], Error> {
    return Effect.tryPromise({
      try: async () => {
        const eventsRef = this.db
          .collection("sessions")
          .doc(aggregateID)
          .collection("events")

        // Firestore requires the inequality filter field to match the first orderBy field.
        let q = fromSeq !== undefined
          ? eventsRef.where("seq", ">", fromSeq).orderBy("seq", "asc")
          : eventsRef.orderBy("seq", "asc")

        const snap = await q.get()
        return snap.docs.map((d) => d.data() as StoredEvent)
      },
      catch: (e) => new Error(`FirestoreEventRepository.load failed: ${e}`),
    }).pipe(
      Effect.flatMap((stored) =>
        Effect.forEach(stored, decodeStoredEvent),
      ),
    )
  }

  loadFromCompaction(
    aggregateID: string,
  ): Effect.Effect<SessionEvent.DurableEvent[], Error> {
    return Effect.tryPromise({
      try: async () => {
        const sessionSnap = await this.db
          .collection("sessions")
          .doc(aggregateID)
          .get()

        const lastCompactionSeq: number =
          (sessionSnap.data()?.["lastCompactionSeq"] as number | undefined) ?? 0

        return lastCompactionSeq
      },
      catch: (e) =>
        new Error(
          `FirestoreEventRepository.loadFromCompaction session read failed: ${e}`,
        ),
    }).pipe(Effect.flatMap((fromSeq) => this.load(aggregateID, fromSeq > 0 ? fromSeq - 1 : undefined)))
  }
}

export const FirestoreEventRepositoryLive: Layer.Layer<
  EventRepository,
  never,
  FirestoreClient
> = Layer.effect(
  EventRepository,
  Effect.gen(function* () {
    const { db } = yield* FirestoreClient
    return new FirestoreEventRepositoryImpl(db)
  }),
)
