import { DateTime, Effect, Layer, Schema } from "effect"
import type { Firestore } from "@google-cloud/firestore"
import { FirestoreClient } from "@gco/infra-gcp"
import {
  SessionRepository,
  type ISessionRepository,
  type ListAnchor,
} from "@gco/model-domain"
import { Session } from "@gco/schema"

/**
 * Decode a raw Firestore document snapshot into a `Session.Info`.
 * The document stores timestamps as epoch-millis numbers which aligns with
 * the `DateTimeUtcFromMillis` codec in `Session.Info`.
 */
const decodeSessionSync = Schema.decodeUnknownSync(Session.Info)
const encodeSessionSync = Schema.encodeSync(Session.Info)

/**
 * Convert a `Partial<Session.Info>` to a plain Firestore-compatible update
 * object. `DateTime` values are converted to epoch-millis numbers.
 */
function encodeSessionPatch(
  patch: Partial<Session.Info>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue

    if (key === "time" && typeof value === "object" && value !== null) {
      // Encode nested time struct: { created, updated, archived? }
      const timeObj = value as Session.Info["time"]
      const encodedTime: Record<string, unknown> = {}
      if (timeObj.created !== undefined) {
        encodedTime["created"] = DateTime.toEpochMillis(timeObj.created)
      }
      if (timeObj.updated !== undefined) {
        encodedTime["updated"] = DateTime.toEpochMillis(timeObj.updated)
      }
      if (timeObj.archived !== undefined) {
        encodedTime["archived"] = DateTime.toEpochMillis(timeObj.archived)
      }
      result["time"] = encodedTime
    } else {
      result[key] = value
    }
  }

  return result
}

class FirestoreSessionRepositoryImpl implements ISessionRepository {
  constructor(private readonly db: Firestore) {}

  get(id: Session.ID): Effect.Effect<Session.Info | undefined, Error> {
    return Effect.tryPromise({
      try: async () => {
        const snap = await this.db.collection("sessions").doc(id).get()
        if (!snap.exists) return undefined
        return snap.data() as unknown
      },
      catch: (e) => new Error(`FirestoreSessionRepository.get failed: ${e}`),
    }).pipe(
      Effect.flatMap((raw) => {
        if (raw === undefined) return Effect.succeed(undefined)
        return Effect.try({
          try: () => decodeSessionSync(raw),
          catch: (e) => new Error(`FirestoreSessionRepository.get decode failed: ${e}`),
        })
      }),
    )
  }

  list(
    projectID: string,
    anchor?: ListAnchor,
  ): Effect.Effect<Session.Info[], Error> {
    return Effect.tryPromise({
      try: async () => {
        let q = this.db
          .collection("sessions")
          .where("projectID", "==", projectID)
          .orderBy("time.created", "desc")

        if (anchor?.cursor) {
          // cursor is the session document ID; fetch the snapshot for startAfter
          const cursorSnap = await this.db
            .collection("sessions")
            .doc(anchor.cursor)
            .get()
          if (cursorSnap.exists) {
            q = q.startAfter(cursorSnap)
          }
        }
        if (anchor?.limit) {
          q = q.limit(anchor.limit)
        }

        const snap = await q.get()
        return snap.docs.map((d) => d.data())
      },
      catch: (e) => new Error(`FirestoreSessionRepository.list failed: ${e}`),
    }).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (raw) =>
          Effect.try({
            try: () => decodeSessionSync(raw),
            catch: (e) => new Error(`FirestoreSessionRepository.list decode failed: ${e}`),
          }),
        ),
      ),
    )
  }

  create(info: Session.Info): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => encodeSessionSync(info),
      catch: (e) => new Error(`FirestoreSessionRepository.create encode failed: ${e}`),
    }).pipe(
      Effect.flatMap((encoded) =>
        Effect.tryPromise({
          try: () => this.db.collection("sessions").doc(info.id).set(encoded as object),
          catch: (e) => new Error(`FirestoreSessionRepository.create failed: ${e}`),
        }),
      ),
      Effect.asVoid,
    )
  }

  update(id: Session.ID, patch: Partial<Session.Info>): Effect.Effect<void, Error> {
    // Encode the patch: convert any DateTime values to epoch-millis numbers.
    // We do this by running the full codec on a dummy complete record merged
    // with the patch, then extracting only the patched keys. For simplicity,
    // we convert the patch object directly — DateTime instances expose
    // `DateTime.toEpochMillis()`, and all other values are plain JSON.
    return Effect.tryPromise({
      try: () => {
        const encoded = encodeSessionPatch(patch)
        return this.db
          .collection("sessions")
          .doc(id)
          .update(encoded)
      },
      catch: (e) => new Error(`FirestoreSessionRepository.update failed: ${e}`),
    }).pipe(Effect.asVoid)
  }

  archive(id: Session.ID): Effect.Effect<void, Error> {
    return Effect.tryPromise({
      try: () =>
        this.db
          .collection("sessions")
          .doc(id)
          .update({ "time.archived": Date.now() }),
      catch: (e) => new Error(`FirestoreSessionRepository.archive failed: ${e}`),
    }).pipe(Effect.asVoid)
  }
}

export const FirestoreSessionRepositoryLive: Layer.Layer<
  SessionRepository,
  never,
  FirestoreClient
> = Layer.effect(
  SessionRepository,
  Effect.gen(function* () {
    const { db } = yield* FirestoreClient
    return new FirestoreSessionRepositoryImpl(db)
  }),
)
