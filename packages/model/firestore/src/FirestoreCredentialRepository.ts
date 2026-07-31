import { Effect, Layer, Schema } from "effect"
import type { Firestore } from "@google-cloud/firestore"
import { FirestoreClient } from "@gco/infra-gcp"
import {
  CredentialRepository,
  type ICredentialRepository,
  type CredentialInfo,
} from "@gco/model-domain"
import { Credential, Integration } from "@gco/schema"

/**
 * Wire format stored in `/credentials/{id}`.
 *
 * The `value` field holds the encoded `Credential.Value` (OAuth or Key) as a
 * plain JSON object. The `secretManagerPath` field is an optional reference
 * used by the `model/secrets` layer to look up the raw secret in GCP Secret
 * Manager when needed (e.g. for OAuth access tokens that should not be stored
 * in Firestore). Callers that only need the reference doc can read
 * `secretManagerPath` without deserialising `value`.
 */
interface StoredCredential {
  id: string
  integrationID: string
  label: string
  value: Record<string, unknown>
  secretManagerPath?: string
}

const decodeValueSync = Schema.decodeUnknownSync(Credential.Value)
const encodeValueSync = Schema.encodeSync(Credential.Value)

function toCredentialInfo(stored: StoredCredential): Effect.Effect<CredentialInfo, Error> {
  return Effect.try({
    try: () => decodeValueSync(stored.value),
    catch: (e) => new Error(`FirestoreCredentialRepository decode value failed: ${e}`),
  }).pipe(
    Effect.map((value) => ({
      // Branded types — cast from stored string (already validated at write time)
      id: stored.id as Credential.ID,
      integrationID: stored.integrationID as Integration.ID,
      label: stored.label,
      value,
    })),
  )
}

class FirestoreCredentialRepositoryImpl implements ICredentialRepository {
  constructor(private readonly db: Firestore) {}

  all(): Effect.Effect<CredentialInfo[], Error> {
    return Effect.tryPromise({
      try: async () => {
        const snap = await this.db.collection("credentials").get()
        return snap.docs.map((d) => d.data() as StoredCredential)
      },
      catch: (e) =>
        new Error(`FirestoreCredentialRepository.all failed: ${e}`),
    }).pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, toCredentialInfo)),
    )
  }

  list(
    integrationID: Integration.ID,
  ): Effect.Effect<CredentialInfo[], Error> {
    return Effect.tryPromise({
      try: async () => {
        const snap = await this.db
          .collection("credentials")
          .where("integrationID", "==", integrationID)
          .get()
        return snap.docs.map((d) => d.data() as StoredCredential)
      },
      catch: (e) =>
        new Error(`FirestoreCredentialRepository.list failed: ${e}`),
    }).pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, toCredentialInfo)),
    )
  }

  get(id: Credential.ID): Effect.Effect<CredentialInfo | undefined, Error> {
    return Effect.tryPromise({
      try: async () => {
        const snap = await this.db.collection("credentials").doc(id).get()
        if (!snap.exists) return undefined
        return snap.data() as StoredCredential
      },
      catch: (e) =>
        new Error(`FirestoreCredentialRepository.get failed: ${e}`),
    }).pipe(
      Effect.flatMap((stored) => {
        if (stored === undefined) return Effect.succeed(undefined)
        return toCredentialInfo(stored)
      }),
    )
  }

  create(input: {
    readonly integrationID: Integration.ID
    readonly value: Credential.Value
    readonly label?: string
  }): Effect.Effect<CredentialInfo, Error> {
    const id = Credential.ID.create()

    return Effect.try({
      try: () => encodeValueSync(input.value),
      catch: (e) => new Error(`FirestoreCredentialRepository.create encode failed: ${e}`),
    }).pipe(
      Effect.flatMap((encodedValue) => {
        const stored: StoredCredential = {
          id,
          integrationID: input.integrationID,
          label: input.label ?? "",
          value: encodedValue as Record<string, unknown>,
        }

        return Effect.tryPromise({
          try: () =>
            this.db
              .collection("credentials")
              .doc(id)
              .set(stored as unknown as Record<string, unknown>),
          catch: (e) =>
            new Error(`FirestoreCredentialRepository.create failed: ${e}`),
        }).pipe(
          Effect.map((): CredentialInfo => ({
            id,
            integrationID: input.integrationID,
            label: stored.label,
            value: input.value,
          })),
        )
      }),
    )
  }

  update(
    id: Credential.ID,
    updates: Partial<Pick<CredentialInfo, "label" | "value">>,
  ): Effect.Effect<void, Error> {
    const patch: Record<string, unknown> = {}

    if (updates.label !== undefined) {
      patch["label"] = updates.label
    }

    if (updates.value !== undefined) {
      return Effect.try({
        try: () => encodeValueSync(updates.value!),
        catch: (e) => new Error(`FirestoreCredentialRepository.update encode failed: ${e}`),
      }).pipe(
        Effect.flatMap((encodedValue) => {
          patch["value"] = encodedValue
          return Effect.tryPromise({
            try: () =>
              this.db.collection("credentials").doc(id).update(patch),
            catch: (e) =>
              new Error(
                `FirestoreCredentialRepository.update failed: ${e}`,
              ),
          })
        }),
        Effect.asVoid,
      )
    }

    return Effect.tryPromise({
      try: () => this.db.collection("credentials").doc(id).update(patch),
      catch: (e) =>
        new Error(`FirestoreCredentialRepository.update failed: ${e}`),
    }).pipe(Effect.asVoid)
  }

  remove(id: Credential.ID): Effect.Effect<void, Error> {
    return Effect.tryPromise({
      try: () => this.db.collection("credentials").doc(id).delete(),
      catch: (e) =>
        new Error(`FirestoreCredentialRepository.remove failed: ${e}`),
    }).pipe(Effect.asVoid)
  }
}

export const FirestoreCredentialRepositoryLive: Layer.Layer<
  CredentialRepository,
  never,
  FirestoreClient
> = Layer.effect(
  CredentialRepository,
  Effect.gen(function* () {
    const { db } = yield* FirestoreClient
    return new FirestoreCredentialRepositoryImpl(db)
  }),
)
