import { Effect, Layer, Schema } from "effect"
import type { Firestore } from "@google-cloud/firestore"
import { FirestoreClient } from "@gco/infra-gcp"
import {
  PermissionRepository,
  type IPermissionRepository,
} from "@gco/model-domain"
import { PermissionSaved } from "@gco/schema"

const decodeInfoSync = Schema.decodeUnknownSync(PermissionSaved.Info)
const encodeInfoSync = Schema.encodeSync(PermissionSaved.Info)

class FirestorePermissionRepositoryImpl implements IPermissionRepository {
  constructor(private readonly db: Firestore) {}

  list(): Effect.Effect<PermissionSaved.Info[], Error> {
    return Effect.tryPromise({
      try: async () => {
        const snap = await this.db.collection("permissions").get()
        return snap.docs.map((d) => d.data())
      },
      catch: (e) =>
        new Error(`FirestorePermissionRepository.list failed: ${e}`),
    }).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (raw) =>
          Effect.try({
            try: () => decodeInfoSync(raw),
            catch: (e) => new Error(`FirestorePermissionRepository.list decode failed: ${e}`),
          }),
        ),
      ),
    )
  }

  listForProject(
    projectID: string,
  ): Effect.Effect<PermissionSaved.Info[], Error> {
    return Effect.tryPromise({
      try: async () => {
        const snap = await this.db
          .collection("permissions")
          .where("projectID", "==", projectID)
          .get()
        return snap.docs.map((d) => d.data())
      },
      catch: (e) =>
        new Error(
          `FirestorePermissionRepository.listForProject failed: ${e}`,
        ),
    }).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (raw) =>
          Effect.try({
            try: () => decodeInfoSync(raw),
            catch: (e) => new Error(`FirestorePermissionRepository.listForProject decode failed: ${e}`),
          }),
        ),
      ),
    )
  }

  save(info: PermissionSaved.Info): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => encodeInfoSync(info),
      catch: (e) => new Error(`FirestorePermissionRepository.save encode failed: ${e}`),
    }).pipe(
      Effect.flatMap((encoded) =>
        // Use set() with merge to replace any existing rule for the same ID
        Effect.tryPromise({
          try: () =>
            this.db
              .collection("permissions")
              .doc(info.id)
              .set(encoded as object),
          catch: (e) =>
            new Error(`FirestorePermissionRepository.save failed: ${e}`),
        }),
      ),
      Effect.asVoid,
    )
  }

  remove(id: PermissionSaved.ID): Effect.Effect<void, Error> {
    return Effect.tryPromise({
      try: () => this.db.collection("permissions").doc(id).delete(),
      catch: (e) =>
        new Error(`FirestorePermissionRepository.remove failed: ${e}`),
    }).pipe(Effect.asVoid)
  }

  removeAllForProject(projectID: string): Effect.Effect<void, Error> {
    return Effect.tryPromise({
      try: async () => {
        const snap = await this.db
          .collection("permissions")
          .where("projectID", "==", projectID)
          .get()

        const batch = this.db.batch()
        for (const doc of snap.docs) {
          batch.delete(doc.ref)
        }
        await batch.commit()
      },
      catch: (e) =>
        new Error(
          `FirestorePermissionRepository.removeAllForProject failed: ${e}`,
        ),
    }).pipe(Effect.asVoid)
  }
}

export const FirestorePermissionRepositoryLive: Layer.Layer<
  PermissionRepository,
  never,
  FirestoreClient
> = Layer.effect(
  PermissionRepository,
  Effect.gen(function* () {
    const { db } = yield* FirestoreClient
    return new FirestorePermissionRepositoryImpl(db)
  }),
)
