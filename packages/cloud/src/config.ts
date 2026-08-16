import { Config, Context, Effect, Layer } from "effect"

export interface GcpConfigShape {
  readonly projectId: string
  readonly region: string
}

export class GcpConfig extends Context.Service<GcpConfig, GcpConfigShape>()("@gco/cloud/GcpConfig") {
  static readonly layer: Layer.Layer<GcpConfig, Config.ConfigError> =
    Layer.effect(
      GcpConfig,
      Effect.gen(function* () {
        const projectId = yield* Config.string("NEKO_PROJECT_ID")
        const region = yield* Config.withDefault(
          Config.string("NEKO_REGION"),
          "us-central1",
        )
        return { projectId, region }
      }),
    )
}
