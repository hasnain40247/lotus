/**
 * bootstrap.ts — Effect Layer compositions for gcloud-opencode.
 *
 * Two exported layers:
 *   ProductionLayer — real GCP services (Firestore, Secret Manager, Vertex AI)
 *   TestLayer       — in-memory repositories, no GCP needed
 *
 * Layer wiring rules:
 *   Layer.mergeAll evaluates layers in parallel — siblings cannot satisfy each
 *   other's requirements. Use Layer.provide(dep) to explicitly wire a dependency
 *   into a layer before merging it with others.
 */

import { Effect, Layer } from "effect"

// GCP infrastructure
import {
  GcpConfig,
  FirestoreClient,
  GCSStorage,
  CloudLogger,
  GoogleIdentity,
  SecretManagerClient,
} from "@gco/cloud"

// LLM providers
import * as DeepSeekProvider from "@gco/llm/providers/deepseek"

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
// ModelResolver implementations
// ---------------------------------------------------------------------------

const multiProviderModelResolverLayer: Layer.Layer<ModelResolver, never, GcpConfig> = Layer.effect(
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
        "deepseek-chat"

      const providerID =
        (session.model as any)?.providerID ??
        (session.model as any)?.provider ??
        ""

      const isDeepSeek =
        providerID === "deepseek" ||
        modelId.startsWith("deepseek") ||
        modelId.includes("deepseek")

      if (isDeepSeek) {
        const apiKey = process.env.DEEPSEEK_API_KEY
        const ds = DeepSeekProvider.configure({ apiKey })
        return Effect.succeed(ds.model(modelId) as unknown as Model)
      }

      return Effect.succeed(vertexProvider.model(modelId) as unknown as Model)
    }

    return ModelResolver.of({ resolve })
  }),
)

const testModelResolverLayer: Layer.Layer<ModelResolver> = Layer.succeed(
  ModelResolver,
  ModelResolver.of({
    resolve: (_session: Session.Info) => {
      const fakeModel = {} as unknown as Model
      return Effect.succeed(fakeModel)
    },
  }),
)

// ---------------------------------------------------------------------------
// LLM Client layer
// ---------------------------------------------------------------------------

const llmClientLayer: Layer.Layer<LLMClientService> = LLMClient.layer.pipe(
  Layer.provide(RequestExecutor.fetchLayer),
)

// ---------------------------------------------------------------------------
// Production Layer
// ---------------------------------------------------------------------------

// GCP primitive services — all require GcpConfig, provided here.
const gcpServicesLayer = Layer.mergeAll(
  FirestoreClient.layer,
  GCSStorage.layer,
  CloudLogger.layer,
  GoogleIdentity.layer,
  SecretManagerClient.layer,
  multiProviderModelResolverLayer,
).pipe(Layer.provide(GcpConfig.layer))

// Model repositories — require GCP services + GcpConfig (SecretsModelLayer uses it directly).
const modelReposLayer = Layer.mergeAll(
  FirestoreModelLayer,
  SecretsModelLayer,
).pipe(Layer.provide(Layer.merge(gcpServicesLayer, GcpConfig.layer)))

// Infrastructure available to all controllers (everything except SessionRunner itself).
const infraLayer = Layer.mergeAll(
  GcpConfig.layer,
  gcpServicesLayer,
  modelReposLayer,
  llmClientLayer,
  agentLayer,
  toolRegistryLayer,
  mcpAuthLayer,
)

// SessionRunner needs LLM, repos, ToolRegistry, and ModelResolver — all in infraLayer.
const sessionRunnerWithDeps = sessionRunnerLayer.pipe(Layer.provide(infraLayer))

// Top-level controllers — need repos, GCSStorage, and SessionRunner.
const controllersLayer = Layer.mergeAll(
  sessionControllerLayer,
  sessionExporterLayer,
  sessionImporterLayer,
  toolPermissionEnforcerLayer,
  mcpLayer(process.cwd()).pipe(Layer.provide(mcpAuthLayer)),
).pipe(Layer.provide(Layer.merge(infraLayer, sessionRunnerWithDeps)))

export const ProductionLayer: Layer.Layer<any, any, never> = Layer.mergeAll(
  infraLayer,
  sessionRunnerWithDeps,
  controllersLayer,
) as unknown as Layer.Layer<any, any, never>

// ---------------------------------------------------------------------------
// Test Layer
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

// Infrastructure for tests — in-memory repos, no GCP needed.
const testInfraLayer = Layer.mergeAll(
  TestModelLayer,
  stubGCSStorageLayer,
  stubGoogleIdentityLayer,
  llmClientLayer,
  agentLayer,
  toolRegistryLayer,
  mcpAuthLayer,
  testModelResolverLayer,
)

const testSessionRunnerWithDeps = sessionRunnerLayer.pipe(Layer.provide(testInfraLayer))

const testControllersLayer = Layer.mergeAll(
  sessionControllerLayer,
  sessionExporterLayer,
  sessionImporterLayer,
  toolPermissionEnforcerLayer,
  mcpLayer(process.cwd()).pipe(Layer.provide(mcpAuthLayer)),
).pipe(Layer.provide(Layer.merge(testInfraLayer, testSessionRunnerWithDeps)))

export const TestLayer: Layer.Layer<any, any, never> = Layer.mergeAll(
  testInfraLayer,
  testSessionRunnerWithDeps,
  testControllersLayer,
) as unknown as Layer.Layer<any, any, never>
