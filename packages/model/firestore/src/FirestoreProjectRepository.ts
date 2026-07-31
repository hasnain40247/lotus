import { Effect, Layer, Schema } from "effect"
import type { Firestore } from "@google-cloud/firestore"
import { FirestoreClient } from "@gco/infra-gcp"
import {
  ProjectRepository,
  type IProjectRepository,
} from "@gco/model-domain"
import { Project } from "@gco/schema"

const decodeInfoSync = Schema.decodeUnknownSync(Project.Info)
const encodeInfoSync = Schema.encodeSync(Project.Info)

class FirestoreProjectRepositoryImpl implements IProjectRepository {
  constructor(private readonly db: Firestore) {}

  get(id: Project.ID): Effect.Effect<Project.Info | undefined, Error> {
    return Effect.tryPromise({
      try: async () => {
        const snap = await this.db.collection("projects").doc(id).get()
        if (!snap.exists) return undefined
        return snap.data() as unknown
      },
      catch: (e) =>
        new Error(`FirestoreProjectRepository.get failed: ${e}`),
    }).pipe(
      Effect.flatMap((raw) => {
        if (raw === undefined) return Effect.succeed(undefined)
        return Effect.try({
          try: () => decodeInfoSync(raw),
          catch: (e) => new Error(`FirestoreProjectRepository.get decode failed: ${e}`),
        })
      }),
    )
  }

  getByWorktree(
    worktree: string,
  ): Effect.Effect<Project.Info | undefined, Error> {
    return Effect.tryPromise({
      try: async () => {
        const snap = await this.db
          .collection("projects")
          .where("worktree", "==", worktree)
          .limit(1)
          .get()
        if (snap.empty) return undefined
        const firstDoc = snap.docs[0]
        return (firstDoc ? firstDoc.data() : undefined) as unknown
      },
      catch: (e) =>
        new Error(`FirestoreProjectRepository.getByWorktree failed: ${e}`),
    }).pipe(
      Effect.flatMap((raw) => {
        if (raw === undefined) return Effect.succeed(undefined)
        return Effect.try({
          try: () => decodeInfoSync(raw),
          catch: (e) => new Error(`FirestoreProjectRepository.getByWorktree decode failed: ${e}`),
        })
      }),
    )
  }

  list(): Effect.Effect<Project.Info[], Error> {
    return Effect.tryPromise({
      try: async () => {
        const snap = await this.db.collection("projects").get()
        return snap.docs.map((d) => d.data())
      },
      catch: (e) =>
        new Error(`FirestoreProjectRepository.list failed: ${e}`),
    }).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (raw) =>
          Effect.try({
            try: () => decodeInfoSync(raw),
            catch: (e) => new Error(`FirestoreProjectRepository.list decode failed: ${e}`),
          }),
        ),
      ),
    )
  }

  create(info: Project.Info): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => encodeInfoSync(info),
      catch: (e) => new Error(`FirestoreProjectRepository.create encode failed: ${e}`),
    }).pipe(
      Effect.flatMap((encoded) =>
        // Idempotent: create only if not already present
        Effect.tryPromise({
          try: async () => {
            const ref = this.db.collection("projects").doc(info.id)
            await this.db.runTransaction(async (tx) => {
              const snap = await tx.get(ref)
              if (!snap.exists) {
                tx.set(ref, encoded as object)
              }
            })
          },
          catch: (e) =>
            new Error(`FirestoreProjectRepository.create failed: ${e}`),
        }),
      ),
      Effect.asVoid,
    )
  }

  update(
    id: Project.ID,
    patch: Partial<Project.Info>,
  ): Effect.Effect<void, Error> {
    return Effect.tryPromise({
      try: () =>
        this.db
          .collection("projects")
          .doc(id)
          .update(patch as Record<string, unknown>),
      catch: (e) =>
        new Error(`FirestoreProjectRepository.update failed: ${e}`),
    }).pipe(Effect.asVoid)
  }
}

export const FirestoreProjectRepositoryLive: Layer.Layer<
  ProjectRepository,
  never,
  FirestoreClient
> = Layer.effect(
  ProjectRepository,
  Effect.gen(function* () {
    const { db } = yield* FirestoreClient
    return new FirestoreProjectRepositoryImpl(db)
  }),
)
