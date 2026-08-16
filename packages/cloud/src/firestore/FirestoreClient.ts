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
      // ignoreUndefinedProperties: LLM stream events routinely include
      // provider metadata (e.g. anthropic.caller.toolId) that may be undefined
      // for tool calls the model hasn't fully specified yet. Without this,
      // Firestore rejects the whole event write and the turn fails.
      const db = new Firestore({ projectId: config.projectId, ignoreUndefinedProperties: true })
      return { db }
    }),
  )
}
