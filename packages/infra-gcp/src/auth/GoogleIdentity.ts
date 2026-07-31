import { GoogleAuth } from "google-auth-library"
import { Context, Effect, Layer } from "effect"
import { GcpConfig } from "../config"

export interface UserIdentity {
  readonly email: string
  readonly name: string | undefined
}

/**
 * Resolves the current user's Google identity from Application Default Credentials.
 *
 * Fails at layer construction time (i.e. app startup) with an actionable error
 * message if the user has not run `gcloud auth application-default login`.
 */
export class GoogleIdentity extends Context.Service<GoogleIdentity, UserIdentity>()(
  "@gco/infra-gcp/GoogleIdentity",
) {
  static readonly layer: Layer.Layer<GoogleIdentity, Error, GcpConfig> = Layer.effect(
    GoogleIdentity,
    Effect.gen(function* () {
      const config = yield* GcpConfig

      const auth = new GoogleAuth({
        projectId: config.projectId,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      })

      const client = yield* Effect.tryPromise({
        try: () => auth.getClient(),
        catch: (e) =>
          new Error(
            `Google auth initialization failed: ${e}\n` +
            "Run: gcloud auth application-default login",
          ),
      })

      const tokenResult = yield* Effect.tryPromise({
        try: () => client.getAccessToken(),
        catch: (e) =>
          new Error(
            `Failed to get access token: ${e}\n` +
            "Run: gcloud auth application-default login",
          ),
      })

      if (!tokenResult.token) {
        return yield* Effect.fail(
          new Error(
            "No access token available.\n" +
            "Run: gcloud auth application-default login",
          ),
        )
      }

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${tokenResult.token}` },
          }),
        catch: (e) => new Error(`Failed to reach Google identity endpoint: ${e}`),
      })

      if (!response.ok) {
        return yield* Effect.fail(
          new Error(
            `Google userinfo returned ${response.status}. ` +
            "Run: gcloud auth application-default login",
          ),
        )
      }

      const info = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ email?: string; name?: string }>,
        catch: (e) => new Error(`Failed to parse user identity response: ${e}`),
      })

      if (!info.email) {
        return yield* Effect.fail(
          new Error(
            "Google identity response contained no email address. " +
            "Run: gcloud auth application-default login",
          ),
        )
      }

      return { email: info.email, name: info.name }
    }),
  )
}
