/**
 * SecretManagerCredentialRepository
 *
 * Implements ICredentialRepository using two storage layers:
 *   - Secret Manager: stores the raw credential VALUE bytes
 *   - Firestore:      stores a reference doc with metadata (id, integrationID, label, secretManagerPath)
 *
 * Firestore collection: /credentials/{credentialID}
 * Secret Manager secret: projects/{projectId}/secrets/cred-{credentialID}
 */

import { Firestore } from "@google-cloud/firestore"
import { Effect, Schema } from "effect"
import type { CredentialInfo, ICredentialRepository } from "@gco/model-domain"
import { Credential, Integration } from "@gco/model-domain"
import {
  GcpConfig,
  SecretManagerClient,
  accessLatestVersion,
  addSecretVersion,
  createSecret,
  deleteSecret,
  destroyAllVersions,
} from "@gco/infra-gcp"

// ── Firestore document shape ──────────────────────────────────────────────────

interface CredentialDoc {
  id: string
  integrationID: string
  label: string
  secretManagerPath: string
}

// ── Codec helpers ─────────────────────────────────────────────────────────────

const encodeValue = Schema.encodeSync(Credential.Value)
const decodeValue = Schema.decodeUnknownSync(Credential.Value)

function valueToBuffer(value: Credential.Value): Buffer {
  const json = JSON.stringify(encodeValue(value))
  return Buffer.from(json, "utf-8")
}

function bufferToValue(buf: Buffer): Credential.Value {
  const json = buf.toString("utf-8")
  return decodeValue(JSON.parse(json))
}

function toCredentialID(raw: string): Credential.ID {
  return raw as Credential.ID
}

function toIntegrationID(raw: string): Integration.ID {
  return raw as Integration.ID
}

// ── Repository factory ────────────────────────────────────────────────────────

/**
 * Creates an ICredentialRepository backed by Secret Manager + Firestore.
 *
 * Requires:
 *   - SecretManagerClient in context (for secret operations)
 *   - GcpConfig in context (for projectId used to build secret IDs)
 *
 * The Firestore client is constructed directly inside this factory because:
 *   - It is a peer dependency that needs no extra configuration beyond ADC.
 *   - Keeps this package's dependency footprint minimal.
 */
export const makeSecretManagerCredentialRepository = (): Effect.Effect<
  ICredentialRepository,
  Error,
  SecretManagerClient | GcpConfig
> =>
  Effect.gen(function* () {
    const config = yield* GcpConfig
    const smClient = yield* SecretManagerClient

    const firestore = new Firestore({ projectId: config.projectId })
    const collection = firestore.collection("credentials")

    // ── helpers ──────────────────────────────────────────────────────────────

    const docRef = (id: string) => collection.doc(id)

    const getDoc = (id: string): Effect.Effect<CredentialDoc | undefined, Error> =>
      Effect.tryPromise({
        try: async () => {
          const snap = await docRef(id).get()
          return snap.exists ? (snap.data() as CredentialDoc) : undefined
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })

    const requireDoc = (id: string): Effect.Effect<CredentialDoc, Error> =>
      Effect.flatMap(getDoc(id), (doc) =>
        doc !== undefined
          ? Effect.succeed(doc)
          : Effect.fail(new Error(`Credential not found: ${id}`)),
      )

    const docToInfo = (
      doc: CredentialDoc,
      value: Credential.Value,
    ): CredentialInfo => ({
      id: toCredentialID(doc.id),
      integrationID: toIntegrationID(doc.integrationID),
      label: doc.label,
      value,
    })

    const withSmClient = <A, E>(eff: Effect.Effect<A, E, SecretManagerClient | GcpConfig>): Effect.Effect<A, E> =>
      Effect.provideService(
        Effect.provideService(eff, SecretManagerClient, smClient),
        GcpConfig,
        config,
      )

    // ── all ───────────────────────────────────────────────────────────────────

    const all = (): Effect.Effect<CredentialInfo[], Error> =>
      withSmClient(Effect.gen(function* () {
        const snapshot = yield* Effect.tryPromise({
          try: () => collection.get(),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        })

        const docs = snapshot.docs.map((d) => d.data() as CredentialDoc)

        const results: CredentialInfo[] = yield* Effect.all(
          docs.map((doc) =>
            Effect.gen(function* () {
              const buf = yield* accessLatestVersion(doc.secretManagerPath)
              return docToInfo(doc, bufferToValue(buf))
            }),
          ),
          { concurrency: 5 },
        )

        return results
      }))

    // ── list ──────────────────────────────────────────────────────────────────

    const list = (integrationID: Integration.ID): Effect.Effect<CredentialInfo[], Error> =>
      withSmClient(Effect.gen(function* () {
        const snapshot = yield* Effect.tryPromise({
          try: () =>
            collection.where("integrationID", "==", integrationID as string).get(),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        })

        const docs = snapshot.docs.map((d) => d.data() as CredentialDoc)

        const results: CredentialInfo[] = yield* Effect.all(
          docs.map((doc) =>
            Effect.gen(function* () {
              const buf = yield* accessLatestVersion(doc.secretManagerPath)
              return docToInfo(doc, bufferToValue(buf))
            }),
          ),
          { concurrency: 5 },
        )

        return results
      }))

    // ── get ───────────────────────────────────────────────────────────────────

    const get = (id: Credential.ID): Effect.Effect<CredentialInfo | undefined, Error> =>
      withSmClient(Effect.gen(function* () {
        const doc = yield* getDoc(id as string)
        if (!doc) return undefined

        const buf = yield* accessLatestVersion(doc.secretManagerPath)
        return docToInfo(doc, bufferToValue(buf))
      }))

    // ── create ────────────────────────────────────────────────────────────────

    const create = (input: {
      readonly integrationID: Integration.ID
      readonly value: Credential.Value
      readonly label?: string
    }): Effect.Effect<CredentialInfo, Error> =>
      withSmClient(Effect.gen(function* () {
        const id = Credential.ID.create()
        const secretId = `cred-${id as string}`
        const label = input.label ?? "default"

        // 1. Create the Secret Manager secret (no versions yet)
        const secretName = yield* createSecret(secretId)

        // 2. Add the credential value as the first version
        const payload = valueToBuffer(input.value)
        yield* addSecretVersion(secretName, payload)

        // 3. Write the reference doc to Firestore
        const doc: CredentialDoc = {
          id: id as string,
          integrationID: input.integrationID as string,
          label,
          secretManagerPath: secretName,
        }

        yield* Effect.tryPromise({
          try: () => docRef(id as string).set(doc),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        })

        return {
          id,
          integrationID: input.integrationID,
          label,
          value: input.value,
        } satisfies CredentialInfo
      }))

    // ── update ────────────────────────────────────────────────────────────────

    const update = (
      id: Credential.ID,
      updates: Partial<Pick<CredentialInfo, "label" | "value">>,
    ): Effect.Effect<void, Error> =>
      withSmClient(Effect.gen(function* () {
        if (!updates.label && !updates.value) return

        const doc = yield* requireDoc(id as string)

        // Update label in Firestore if provided
        if (updates.label !== undefined) {
          const label = updates.label
          yield* Effect.tryPromise({
            try: () => docRef(id as string).update({ label }),
            catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
          })
        }

        // Add a new secret version for the updated value
        if (updates.value !== undefined) {
          const payload = valueToBuffer(updates.value)
          yield* addSecretVersion(doc.secretManagerPath, payload)
        }
      }))

    // ── remove ────────────────────────────────────────────────────────────────

    const remove = (id: Credential.ID): Effect.Effect<void, Error> =>
      withSmClient(Effect.gen(function* () {
        const doc = yield* requireDoc(id as string)

        // 1. Destroy all secret versions (marks them DESTROYED)
        yield* destroyAllVersions(doc.secretManagerPath)

        // 2. Delete the secret resource itself
        yield* deleteSecret(doc.secretManagerPath)

        // 3. Delete the Firestore reference doc
        yield* Effect.tryPromise({
          try: () => docRef(id as string).delete(),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        })
      }))

    // ── assemble ──────────────────────────────────────────────────────────────

    return { all, list, get, create, update, remove } satisfies ICredentialRepository
  })
