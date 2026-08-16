import { Effect, Schema, Stream } from "effect"
import { createAnthropic, type AnthropicProvider } from "@ai-sdk/anthropic"
import { streamText } from "ai"

import type { Route, AnyRoute } from "../route/client"
import type { Endpoint } from "../route/endpoint"
import type { Transport } from "../route/transport"
import { Auth } from "../route/auth"
import * as ProviderShared from "../protocols/shared"
import {
  LLMError,
  LLMEvent,
  type LLMRequest,
  Model,
  type ModelID,
  ProviderID,
} from "../schema"
import { requestToStreamTextArgs, streamPartToLLMEvent } from "./aisdk/translate"

export const id = ProviderID.make("anthropic")

export const BASE_URL = "https://api.anthropic.com/v1"

export interface Config {
  readonly apiKey?: string
  readonly baseURL?: string
  readonly headers?: Record<string, string>
}

const ROUTE_ID = "anthropic-aisdk"
const PROTOCOL_ID = "ai-sdk"

const noopTransport: Transport<unknown, unknown, unknown> = {
  id: "aisdk-inproc",
  prepare: () => Effect.succeed(undefined),
  frames: () => Stream.empty,
}

const noopEndpoint: Endpoint<unknown> = { baseURL: BASE_URL, path: "" }

/**
 * Runs `streamText` and lifts its `fullStream` into an Effect Stream of
 * `LLMEvent`. Errors from the AI SDK are wrapped as `LLMError`.
 */
const streamViaAISDK = (
  provider: AnthropicProvider,
  modelId: string,
  request: LLMRequest,
): Stream.Stream<LLMEvent, LLMError> => {
  const routeName = `${request.model.provider}/${ROUTE_ID}`

  async function* produce(): AsyncGenerator<LLMEvent> {
    const args = requestToStreamTextArgs(request)
    const result = streamText({
      model: provider(modelId as never),
      system: args.system,
      messages: args.messages,
      tools: args.tools,
      toolChoice: args.toolChoice as never,
      temperature: args.temperature,
      topP: args.topP,
      topK: args.topK,
      maxOutputTokens: args.maxOutputTokens,
      stopSequences: args.stopSequences,
      seed: args.seed,
      presencePenalty: args.presencePenalty,
      frequencyPenalty: args.frequencyPenalty,
      headers: args.headers,
    })

    let stepIndex = 0
    const toolNames = new Map<string, string>()

    for await (const part of result.fullStream) {
      const emitted = streamPartToLLMEvent(part as never, stepIndex, toolNames)
      if (part.type === "finish-step") stepIndex++
      if (emitted === undefined) continue
      if (Array.isArray(emitted)) {
        for (const event of emitted) yield event
      } else {
        yield emitted as LLMEvent
      }
    }
  }

  return Stream.fromAsyncIterable(produce(), (error) =>
    ProviderShared.eventError(
      routeName,
      "Anthropic AI SDK stream failed",
      error instanceof Error ? error.message : String(error),
    ),
  )
}

export const configure = (config: Config = {}) => {
  const sdkProvider = createAnthropic({
    apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
    baseURL: config.baseURL,
    headers: config.headers,
  })

  const buildRoute = (modelId: string): Route<unknown, unknown> => {
    const route: Route<unknown, unknown> = {
      id: ROUTE_ID,
      provider: id,
      protocol: PROTOCOL_ID,
      endpoint: noopEndpoint,
      auth: Auth.none,
      transport: noopTransport,
      defaults: {},
      body: {
        schema: Schema.Unknown as never,
        from: () => Effect.succeed(undefined),
      },
      with: () => route,
      model: (input) =>
        Model.make({
          ...input,
          provider: id,
          route: route as AnyRoute,
        } as never),
      prepareTransport: () => Effect.succeed(undefined),
      streamPrepared: (_prepared, request) => streamViaAISDK(sdkProvider, modelId, request),
    }
    return route
  }

  const model = (modelID: string | ModelID) =>
    Model.make({
      id: modelID,
      provider: id,
      route: buildRoute(String(modelID)) as AnyRoute,
    })

  return { id, model, configure }
}

export const provider = configure()
export const model = provider.model
