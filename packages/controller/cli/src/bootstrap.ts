/**
 * bootstrap.ts — Effect Layer compositions for gcloud-opencode.
 *
 * Two exported layers:
 *   ProductionLayer — real GCP services (Firestore, Secret Manager, Vertex AI)
 *   TestLayer       — in-memory repositories, no GCP needed
 */

import { Effect, Layer } from "effect"

// GCP infrastructure
import { GcpConfig, FirestoreClient, GCSStorage, CloudLogger, GoogleIdentity } from "@gco/cloud"

// Model layer
import { FirestoreModelLayer } from "@gco/model-firestore"
import { SecretsModelLayer } from "@gco/model-secrets"
import { TestModelLayer } from "@gco/model-test"

// Controllers
import {
  sessionControllerLayer,
  sessionRunnerLayer,
  sessionExporterLayer,
  sessionImporterLayer,
  ModelResolver,
  type ModelResolverInterface,
} from "@gco/controller-session"
import { agentLayer } from "@gco/controller-agent"
import { mcpLayer, mcpAuthLayer } from "@gco/controller-mcp"
import { toolRegistryLayer, toolPermissionEnforcerLayer } from "@gco/controller-tool"

// LLM infrastructure
import { LLMClient, type LLMClientService } from "@gco/llm"
import { RequestExecutor } from "@gco/llm/route"
import * as VertexProvider from "@gco/llm/providers/vertex"
import type { Model } from "@gco/llm"
import type { Session } from "@gco/schema"

// ---------------------------------------------------------------------------
// ModelResolver implementation — resolves Vertex AI models
// ---------------------------------------------------------------------------

/**
 * A concrete ModelResolver backed by Vertex AI.
 *
 * Resolves the model from the session's configured model ID + providerID.
 * Falls back to gemini-2.5-pro-preview-06-05 when no model is configured.
 */
const vertexModelResolverLayer: Layer.Layer<ModelResolver, never, GcpConfig> = Layer.effect(
  ModelResolver,
  Effect.gen(function* () {
    const config = yield* GcpConfig
    const vertexProvider = VertexProvider.configure({
      projectId: config.projectId,
      region: config.region,
    })

    const resolve: ModelResolverInterface["resolve"] = (session: Session.Info) => {
      const modelId =
        session.model?.id ??
        (session.model as any)?.modelID ??
        "gemini-2.5-pro-preview-06-05"

      const model = vertexProvider.model(modelId) as unknown as Model
      return Effect.succeed(model)
    }

    return ModelResolver.of({ resolve })
  }),
)

/**
 * Fallback ModelResolver for TestLayer — always returns a fixed test model.
 */
const testModelResolverLayer: Layer.Layer<ModelResolver> = Layer.succeed(
  ModelResolver,
  ModelResolver.of({
    resolve: (_session: Session.Info) => {
      // In tests, there is no real LLM — this satisfies the type constraint.
      const fakeModel = {} as unknown as Model
      return Effect.succeed(fakeModel)
    },
  }),
)

// ---------------------------------------------------------------------------
// LLM Client layer — uses the native fetch-based HTTP executor
// ---------------------------------------------------------------------------

const llmClientLayer: Layer.Layer<LLMClientService> = LLMClient.layer.pipe(
  Layer.provide(RequestExecutor.fetchLayer),
)

// ---------------------------------------------------------------------------
// Production Layer — wires real GCP services
// ---------------------------------------------------------------------------

/**
 * Production Effect Layer. Uses Firestore for session/event/credential storage,
 * Secret Manager for secrets, Vertex AI for LLM calls, and Cloud Logging.
 *
 * Usage:
 *   Effect.runPromise(program.pipe(Effect.provide(ProductionLayer)))
 */
export const ProductionLayer: Layer.Layer<any, any, never> = Layer.mergeAll(
  // GCP infrastructure
  GcpConfig.layer,
  FirestoreClient.layer,
  GCSStorage.layer,
  CloudLogger.layer,
  GoogleIdentity.layer,

  // Model layer (Firestore-backed)
  FirestoreModelLayer,
  SecretsModelLayer,

  // LLM client
  llmClientLayer,

  // Model resolver (Vertex AI)
  vertexModelResolverLayer,

  // Controllers
  sessionControllerLayer,
  sessionRunnerLayer,
  sessionExporterLayer,
  sessionImporterLayer,
  agentLayer,
  mcpLayer(process.cwd()).pipe(Layer.provide(mcpAuthLayer)),
  mcpAuthLayer,
  toolRegistryLayer,
  toolPermissionEnforcerLayer,
) as unknown as Layer.Layer<any, any, never>

// ---------------------------------------------------------------------------
// Test Layer — in-memory repos, no GCP needed
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stubs for TestLayer (no-op / fixed implementations)
// ---------------------------------------------------------------------------

const stubGoogleIdentityLayer: Layer.Layer<GoogleIdentity> = Layer.succeed(
  GoogleIdentity,
  GoogleIdentity.of({ email: "test@example.com", name: "Test User" }),
)

const stubGCSStorageLayer: Layer.Layer<GCSStorage> = Layer.succeed(
  GCSStorage,
  GCSStorage.of({
    client: null as any,
    exportsBucket: "test-exports",
    artifactsBucket: "test-artifacts",
    write: (_key: string, _data: Buffer, _mime: string) =>
      Effect.fail(new Error("GCSStorage not available in test mode")),
    read: (_uri: string) =>
      Effect.fail(new Error("GCSStorage not available in test mode")),
    list: (_prefix: string) =>
      Effect.fail(new Error("GCSStorage not available in test mode")),
  }),
)

/**
 * Test Effect Layer. Uses in-memory repositories — no network calls or GCP
 * credentials required. Suitable for unit tests and CI environments.
 */
export const TestLayer: Layer.Layer<any, any, never> = Layer.mergeAll(
  TestModelLayer,
  stubGCSStorageLayer,
  stubGoogleIdentityLayer,

  // LLM client (still uses real HTTP but with a fake model resolver)
  llmClientLayer,
  testModelResolverLayer,

  // Controllers
  sessionControllerLayer,
  sessionRunnerLayer,
  sessionExporterLayer,
  sessionImporterLayer,
  agentLayer,
  mcpLayer(process.cwd()).pipe(Layer.provide(mcpAuthLayer)),
  mcpAuthLayer,
  toolRegistryLayer,
  toolPermissionEnforcerLayer,
) as unknown as Layer.Layer<any, any, never>
