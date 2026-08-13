/**
 * Vertex AI provider for @gco/llm.
 *
 * Uses the Gemini protocol (which Vertex AI natively supports) with
 * Vertex-specific endpoint URLs and Google OAuth2 authentication via
 * Application Default Credentials (ADC).
 *
 * The endpoint pattern is:
 *   https://{region}-aiplatform.googleapis.com/v1/projects/{projectId}/
 *     locations/{region}/publishers/google/models/{model}:streamGenerateContent?alt=sse
 *
 * Auth is resolved from the VERTEX_ACCESS_TOKEN environment variable or via ADC.
 * For production, run `gcloud auth application-default login` or use a service account.
 */
import { Config, Effect } from "effect"
import { ProviderID, type ModelID } from "../schema"
import * as Gemini from "../protocols/gemini"
import { Auth } from "../route/auth"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { Route } from "../route/client"
import type { RouteDefaultsInput } from "../route/client"

export const id = ProviderID.make("vertex")

export const SUPPORTED_MODELS = [
  "gemini-2.0-flash-001",
  "gemini-2.5-pro-preview-06-05",
] as const

export type VertexModelId = (typeof SUPPORTED_MODELS)[number] | (string & {})

export type Config = RouteDefaultsInput & {
  readonly projectId?: string
  readonly region?: string
  readonly accessToken?: string
}

const DEFAULT_REGION = "us-central1"

/**
 * Resolve a Vertex AI access token. Resolution order:
 * 1. Explicit `accessToken` option
 * 2. VERTEX_ACCESS_TOKEN environment variable
 * 3. GOOGLE_ACCESS_TOKEN environment variable
 */
const resolveAuth = (options: Config): Auth => {
  if (options.accessToken) {
    return Auth.value(options.accessToken, "accessToken").bearer()
  }
  return Auth.optional(undefined, "accessToken")
    .orElse(Auth.config("VERTEX_ACCESS_TOKEN"))
    .orElse(Auth.config("GOOGLE_ACCESS_TOKEN"))
    .bearer()
}

const makeVertexRoute = (projectId: string, region: string, auth: Auth, defaults: RouteDefaultsInput) =>
  Route.make({
    id: "vertex-gemini",
    provider: "vertex",
    protocol: Gemini.protocol,
    endpoint: Endpoint.path(
      ({ request }) => {
        const model = String(request.model.id)
        return `/publishers/google/models/${model}:streamGenerateContent`
      },
      {
        baseURL: `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}`,
        query: { alt: "sse" },
      },
    ),
    auth,
    framing: Framing.sse,
    defaults,
  })

export const configure = (input: Config = {}) => {
  const { projectId, region, accessToken: _, ...defaults } = input
  const auth = resolveAuth(input)
  const resolvedRegion = region ?? DEFAULT_REGION
  const resolvedProjectId = projectId ?? "unknown-project"

  const route = makeVertexRoute(resolvedProjectId, resolvedRegion, auth, defaults)

  return {
    id,
    model: (modelID: string | ModelID) => route.model({ id: modelID }),
    configure,
  }
}

export const provider = configure()
export const model = provider.model

/**
 * Effect-based factory that resolves project/region from GCP config environment
 * variables automatically. Use this when you don't want to pass config explicitly.
 */
export const fromEnv = Effect.gen(function* () {
  const projectId = yield* Config.string("LOTUS_PROJECT_ID").pipe(
    Effect.catch(() => Config.string("GOOGLE_CLOUD_PROJECT")),
    Effect.catch(() => Effect.succeed("unknown-project")),
  )
  const region = yield* Config.string("LOTUS_REGION").pipe(
    Effect.catch(() => Effect.succeed(DEFAULT_REGION)),
  )
  return configure({ projectId, region })
})
