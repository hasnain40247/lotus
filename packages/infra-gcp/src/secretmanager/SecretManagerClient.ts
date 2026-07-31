import { SecretManagerServiceClient } from "@google-cloud/secret-manager"
import { Context, Effect, Layer } from "effect"
import { GcpConfig } from "../config"

export interface SecretManagerClientShape {
  readonly client: SecretManagerServiceClient
}

export class SecretManagerClient extends Context.Service<SecretManagerClient, SecretManagerClientShape>()("@gco/infra-gcp/SecretManagerClient") {
  static readonly layer: Layer.Layer<
    SecretManagerClient,
    never,
    GcpConfig
  > = Layer.effect(
    SecretManagerClient,
    Effect.gen(function* () {
      const config = yield* GcpConfig
      const client = new SecretManagerServiceClient({
        projectId: config.projectId,
      })
      return { client }
    }),
  )
}

// ── Helper Effects ──────────────────────────────────────────────────────────

/**
 * Create a new secret (without any versions).
 * Returns the fully-qualified secret name, e.g.
 * "projects/my-project/secrets/my-secret".
 */
export const createSecret = (
  secretId: string,
): Effect.Effect<string, Error, SecretManagerClient | GcpConfig> =>
  Effect.gen(function* () {
    const { client } = yield* SecretManagerClient
    const config = yield* GcpConfig
    const parent = `projects/${config.projectId}`

    const [secret] = yield* Effect.tryPromise({
      try: () =>
        client.createSecret({
          parent,
          secretId,
          secret: {
            replication: { automatic: {} },
          },
        }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    })

    return secret.name ?? `${parent}/secrets/${secretId}`
  })

/**
 * Add a new version to an existing secret.
 * `secretName` is the resource name returned by `createSecret`.
 * Returns the version resource name.
 */
export const addSecretVersion = (
  secretName: string,
  payload: Buffer,
): Effect.Effect<string, Error, SecretManagerClient> =>
  Effect.gen(function* () {
    const { client } = yield* SecretManagerClient

    const [version] = yield* Effect.tryPromise({
      try: () =>
        client.addSecretVersion({
          parent: secretName,
          payload: { data: payload },
        }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    })

    return version.name ?? `${secretName}/versions/latest`
  })

/**
 * Access the latest version of a secret and return the payload bytes.
 * `secretName` is the resource name, e.g. "projects/p/secrets/s".
 */
export const accessLatestVersion = (
  secretName: string,
): Effect.Effect<Buffer, Error, SecretManagerClient> =>
  Effect.gen(function* () {
    const { client } = yield* SecretManagerClient
    const resourceName = `${secretName}/versions/latest`

    const [version] = yield* Effect.tryPromise({
      try: () => client.accessSecretVersion({ name: resourceName }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    })

    const data = version.payload?.data
    if (!data) {
      return yield* Effect.fail(
        new Error(`Secret version ${resourceName} has no payload`),
      )
    }

    return Buffer.from(data as Uint8Array)
  })

/**
 * Destroy all enabled versions of a secret (marks them DESTROYED).
 * This does not delete the secret itself.
 */
export const destroyAllVersions = (
  secretName: string,
): Effect.Effect<void, Error, SecretManagerClient> =>
  Effect.gen(function* () {
    const { client } = yield* SecretManagerClient

    const [versions] = yield* Effect.tryPromise({
      try: () => client.listSecretVersions({ parent: secretName }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    })

    yield* Effect.all(
      (versions ?? [])
        .filter((v) => v.name != null && String(v.state) === "ENABLED")
        .map((v) =>
          Effect.tryPromise({
            try: () => client.destroySecretVersion({ name: v.name! }),
            catch: (cause) =>
              cause instanceof Error ? cause : new Error(String(cause)),
          }),
        ),
      { concurrency: 5 },
    )
  })

/**
 * Delete a secret and all its versions permanently.
 * `secretName` is the resource name, e.g. "projects/p/secrets/s".
 */
export const deleteSecret = (
  secretName: string,
): Effect.Effect<void, Error, SecretManagerClient> =>
  Effect.gen(function* () {
    const { client } = yield* SecretManagerClient

    yield* Effect.tryPromise({
      try: () => client.deleteSecret({ name: secretName }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    })
  })
