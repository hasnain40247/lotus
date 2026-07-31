import { Firestore } from "@google-cloud/firestore"
import { Context, Effect, Layer } from "effect"
import { GcpConfig } from "../config"

export interface FirestoreClientShape {
  readonly db: Firestore
}

export class FirestoreClient extends Context.Service<FirestoreClient, FirestoreClientShape>()("@gco/cloud/FirestoreClient") {
  static readonly layer: Layer.Layer<
    FirestoreClient,
    never,
    GcpConfig
  > = Layer.effect(
    FirestoreClient,
    Effect.gen(function* () {
      const config = yield* GcpConfig
      const db = new Firestore({ projectId: config.projectId })
      return { db }
    }),
  )
}
