import { Effect, Layer } from "effect"
import type { Firestore, DocumentData } from "@google-cloud/firestore"
import { FirestoreClient, GoogleIdentity } from "@gco/infra-gcp"
import {
  WorkspaceRepository,
  type IWorkspaceRepository,
  type WorkspaceInfo,
} from "@gco/model-domain"
import type { Workspace } from "@gco/schema"

function toWorkspaceInfo(raw: DocumentData): WorkspaceInfo {
  return raw as WorkspaceInfo
}

class FirestoreWorkspaceRepositoryImpl implements IWorkspaceRepository {
  private readonly workspaces: FirebaseFirestore.CollectionReference

  constructor(db: Firestore, userId: string) {
    this.workspaces = db.collection("users").doc(userId).collection("workspaces")
  }

  get(id: Workspace.ID): Effect.Effect<WorkspaceInfo | undefined, Error> {
    return Effect.tryPromise({
      try: async () => {
        const snap = await this.workspaces.doc(id).get()
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
        const snap = await this.workspaces.get()
        return snap.docs.map((d) => toWorkspaceInfo(d.data()))
      },
      catch: (e) =>
        new Error(`FirestoreWorkspaceRepository.list failed: ${e}`),
    })
  }

  create(info: WorkspaceInfo): Effect.Effect<void, Error> {
    return Effect.tryPromise({
      try: async () => {
        const ref = this.workspaces.doc(info.id)
        await this.workspaces.firestore.runTransaction(async (tx) => {
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
      try: () => this.workspaces.doc(id).update(patch as Record<string, unknown>),
      catch: (e) =>
        new Error(`FirestoreWorkspaceRepository.update failed: ${e}`),
    }).pipe(Effect.asVoid)
  }

  remove(id: Workspace.ID): Effect.Effect<void, Error> {
    return Effect.tryPromise({
      try: () => this.workspaces.doc(id).delete(),
      catch: (e) =>
        new Error(`FirestoreWorkspaceRepository.remove failed: ${e}`),
    }).pipe(Effect.asVoid)
  }
}

export const FirestoreWorkspaceRepositoryLive: Layer.Layer<
  WorkspaceRepository,
  never,
  FirestoreClient | GoogleIdentity
> = Layer.effect(
  WorkspaceRepository,
  Effect.gen(function* () {
    const { db } = yield* FirestoreClient
    const { email } = yield* GoogleIdentity
    return new FirestoreWorkspaceRepositoryImpl(db, email)
  }),
)
