import { Storage } from "@google-cloud/storage"
import { Context, Effect, Layer } from "effect"
import { GcpConfig } from "../config"

export interface IArtifactStore {
  /** Write data to the store and return a gs:// URI. */
  write(key: string, data: Buffer, mime: string): Effect.Effect<string, Error>
  /** Read data from a gs:// URI. */
  read(uri: string): Effect.Effect<Buffer, Error>
  /** List all keys under a prefix, returning gs:// URIs. */
  list(prefix: string): Effect.Effect<string[], Error>
}

export interface GCSStorageShape extends IArtifactStore {
  /** The underlying Storage client. */
  readonly client: Storage
  /** Bucket used for session exports. */
  readonly exportsBucket: string
  /** Bucket used for message attachments / artifacts. */
  readonly artifactsBucket: string
}

/**
 * Parse a gs:// URI into { bucket, path }.
 */
function parseGsUri(uri: string): { bucket: string; path: string } {
  if (!uri.startsWith("gs://")) {
    throw new Error(`Invalid gs:// URI: ${uri}`)
  }
  const withoutScheme = uri.slice("gs://".length)
  const slashIndex = withoutScheme.indexOf("/")
  if (slashIndex === -1) {
    return { bucket: withoutScheme, path: "" }
  }
  return {
    bucket: withoutScheme.slice(0, slashIndex),
    path: withoutScheme.slice(slashIndex + 1),
  }
}

export class GCSStorage extends Context.Service<GCSStorage, GCSStorageShape>()("@gco/cloud/GCSStorage") {
  static readonly layer: Layer.Layer<
    GCSStorage,
    never,
    GcpConfig
  > = Layer.effect(
    GCSStorage,
    Effect.gen(function* () {
      const config = yield* GcpConfig

      const client = new Storage({ projectId: config.projectId })
      const exportsBucket = `${config.projectId}-exports`
      const artifactsBucket = `${config.projectId}-artifacts`

      const write = (
        key: string,
        data: Buffer,
        mime: string,
      ): Effect.Effect<string, Error> =>
        Effect.tryPromise({
          try: async () => {
            // Determine which bucket to use based on the key prefix.
            const bucket =
              key.startsWith("sessions/") && key.includes("/export")
                ? exportsBucket
                : artifactsBucket

            await client.bucket(bucket).file(key).save(data, {
              metadata: { contentType: mime },
            })
            return `gs://${bucket}/${key}`
          },
          catch: (cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
        })

      const read = (uri: string): Effect.Effect<Buffer, Error> =>
        Effect.tryPromise({
          try: async () => {
            const { bucket, path } = parseGsUri(uri)
            const [contents] = await client.bucket(bucket).file(path).download()
            return contents as Buffer
          },
          catch: (cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
        })

      const list = (prefix: string): Effect.Effect<string[], Error> =>
        Effect.tryPromise({
          try: async () => {
            const results: string[] = []
            for (const bucketName of [exportsBucket, artifactsBucket]) {
              const [files] = await client
                .bucket(bucketName)
                .getFiles({ prefix })
              for (const file of files) {
                results.push(`gs://${bucketName}/${file.name}`)
              }
            }
            return results
          },
          catch: (cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
        })

      return {
        client,
        exportsBucket,
        artifactsBucket,
        write,
        read,
        list,
      }
    }),
  )
}
