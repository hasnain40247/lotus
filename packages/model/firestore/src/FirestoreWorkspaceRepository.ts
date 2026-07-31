import { Effect, Layer } from "effect"
import type { Firestore, DocumentData } from "@google-cloud/firestore"
import { FirestoreClient } from "@gco/infra-gcp"
import {
  WorkspaceRepository,
  type IWorkspaceRepository,
  type WorkspaceInfo,
} from "@gco/model-domain"
import type { Workspace } from "@gco/schema"

/**
 * `WorkspaceInfo` is defined entirely in the domain layer — there is no
 * `@gco/schema` codec for it, so we read/write the plain object directly.
 * Firestore stores it as flat JSON; the shape is simple enough (no branded
 * types that need codec transformations) to cast directly.
 */
function toWorkspaceInfo(raw: DocumentData): WorkspaceInfo {
  return raw as WorkspaceInfo
}

class FirestoreWorkspaceRepositoryImpl implements IWorkspaceRepository {
  constructor(private readonly db: Firestore) {}

  get(id: Workspace.ID): Effect.Effect<WorkspaceInfo | undefined, Error> {
    return Effect.tryPromise({
      try: async () => {
        const snap = await this.db.collection("workspaces").doc(id).get()
        if (!snap.exists) return undefined
        return toWorkspaceInfo(snap.data()!)
      },
      catch: (e) =>
        new Error(`FirestoreWorkspaceRepository.get failed: ${e}`),
    })
  }

  list(): Effect.Effect<WorkspaceInfo[], Error> {
    return Effect.tryPromise({
      try: async () => {
        const snap = await this.db.collection("workspaces").get()
        return snap.docs.map((d) => toWorkspaceInfo(d.data()))
      },
      catch: (e) =>
        new Error(`FirestoreWorkspaceRepository.list failed: ${e}`),
    })
  }

  create(info: WorkspaceInfo): Effect.Effect<void, Error> {
    return Effect.tryPromise({
      try: async () => {
        const ref = this.db.collection("workspaces").doc(info.id)
        await this.db.runTransaction(async (tx) => {
          const snap = await tx.get(ref)
          if (!snap.exists) {
            tx.set(ref, info as unknown as Record<string, unknown>)
          }
        })
      },
      catch: (e) =>
        new Error(`FirestoreWorkspaceRepository.create failed: ${e}`),
    }).pipe(Effect.asVoid)
  }

  update(
    id: Workspace.ID,
    patch: Partial<WorkspaceInfo>,
  ): Effect.Effect<void, Error> {
    return Effect.tryPromise({
      try: () =>
        this.db
          .collection("workspaces")
          .doc(id)
          .update(patch as Record<string, unknown>),
      catch: (e) =>
        new Error(`FirestoreWorkspaceRepository.update failed: ${e}`),
    }).pipe(Effect.asVoid)
  }

  remove(id: Workspace.ID): Effect.Effect<void, Error> {
    return Effect.tryPromise({
      try: () => this.db.collection("workspaces").doc(id).delete(),
      catch: (e) =>
        new Error(`FirestoreWorkspaceRepository.remove failed: ${e}`),
    }).pipe(Effect.asVoid)
  }
}

export const FirestoreWorkspaceRepositoryLive: Layer.Layer<
  WorkspaceRepository,
  never,
  FirestoreClient
> = Layer.effect(
  WorkspaceRepository,
  Effect.gen(function* () {
    const { db } = yield* FirestoreClient
    return new FirestoreWorkspaceRepositoryImpl(db)
  }),
)
