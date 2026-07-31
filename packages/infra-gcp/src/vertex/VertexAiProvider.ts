import { VertexAI } from "@google-cloud/vertexai"
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from "@ai-sdk/provider"
import { Context, Effect, Layer } from "effect"
import { GcpConfig } from "../config"

// ── Supported model IDs ──────────────────────────────────────────────────────

export type VertexModelId =
  | "gemini-2.0-flash-001"
  | "gemini-2.5-pro-preview-06-05"
  | (string & {})

// ── Prompt conversion helpers ────────────────────────────────────────────────

type GeminiRole = "user" | "model"
type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }
type GeminiContent = { role: GeminiRole; parts: GeminiPart[] }

function toGeminiContents(
  prompt: LanguageModelV2CallOptions["prompt"],
): { system?: string; contents: GeminiContent[] } {
  let system: string | undefined
  const contents: GeminiContent[] = []

  for (const message of prompt) {
    if (message.role === "system") {
      system = message.content
      continue
    }

    if (message.role === "user") {
      const parts: GeminiPart[] = []
      for (const part of message.content) {
        if (part.type === "text") {
          parts.push({ text: part.text })
        } else if (part.type === "file") {
          // Inline data files
          const data =
            typeof part.data === "string"
              ? part.data
              : Buffer.from(part.data as Uint8Array).toString("base64")
          parts.push({ inlineData: { mimeType: part.mediaType, data } })
        }
      }
      contents.push({ role: "user", parts })
      continue
    }

    if (message.role === "assistant") {
      const parts: GeminiPart[] = []
      for (const part of message.content) {
        if (part.type === "text") {
          parts.push({ text: part.text })
        } else if (part.type === "tool-call") {
          // Embed tool calls as text for Gemini compatibility.
          parts.push({
            text: JSON.stringify({ toolCall: part.toolName, input: part.input }),
          })
        }
      }
      contents.push({ role: "model", parts })
      continue
    }

    if (message.role === "tool") {
      // Tool results — send as user message for Gemini compatibility.
      const parts: GeminiPart[] = []
      for (const part of message.content) {
        if (part.type === "tool-result") {
          const output =
            part.output.type === "text"
              ? part.output.value
              : JSON.stringify(part.output.value)
          parts.push({ text: `Tool result for ${part.toolName}: ${output}` })
        }
      }
      if (parts.length > 0) {
        contents.push({ role: "user", parts })
      }
    }
  }

  return { system, contents }
}

// ── Finish-reason mapping ────────────────────────────────────────────────────

function mapFinishReason(reason: string | undefined): LanguageModelV2FinishReason {
  switch (reason) {
    case "STOP":
      return "stop"
    case "MAX_TOKENS":
      return "length"
    case "SAFETY":
      return "content-filter"
    case "RECITATION":
      return "other"
    case "TOOL_CODE":
      return "tool-calls"
    default:
      return "unknown"
  }
}

// ── Internal request type ────────────────────────────────────────────────────

interface VertexRequest {
  contents: GeminiContent[]
  generationConfig?: {
    maxOutputTokens?: number
    temperature?: number
    topP?: number
    topK?: number
    stopSequences?: string[]
  }
  systemInstruction?: { parts: Array<{ text: string }> }
}

// ── vertexModel factory ──────────────────────────────────────────────────────

/**
 * Create a `LanguageModelV2`-compatible object backed by Vertex AI.
 * The returned object can be passed directly to Vercel AI SDK helpers.
 */
export function vertexModel(
  modelId: VertexModelId,
  projectId: string,
  location: string,
): LanguageModelV2 {
  const vertex = new VertexAI({ project: projectId, location })

  return {
    specificationVersion: "v2" as const,
    provider: "vertex-ai",
    modelId,
    supportedUrls: {},

    async doGenerate(options: LanguageModelV2CallOptions) {
      const generativeModel = vertex.getGenerativeModel({ model: modelId })
      const { system, contents } = toGeminiContents(options.prompt)

      const request: VertexRequest = {
        contents,
        generationConfig: {
          maxOutputTokens: options.maxOutputTokens,
          temperature: options.temperature,
          topP: options.topP,
          topK: options.topK,
          stopSequences: options.stopSequences,
        },
      }

      if (system) {
        request.systemInstruction = { parts: [{ text: system }] }
      }

      const result = await generativeModel.generateContent(
        request as unknown as Parameters<typeof generativeModel.generateContent>[0],
      )
      const response = result.response
      const candidate = response.candidates?.[0]
      const text =
        candidate?.content?.parts
          ?.map((p: { text?: string }) => p.text ?? "")
          .join("") ?? ""
      const finishReason = mapFinishReason(
        candidate?.finishReason as string | undefined,
      )
      const usageMetadata = response.usageMetadata

      const content: LanguageModelV2Content[] = text
        ? [{ type: "text" as const, text }]
        : []

      const usage: LanguageModelV2Usage = {
        inputTokens: usageMetadata?.promptTokenCount,
        outputTokens: usageMetadata?.candidatesTokenCount,
        totalTokens: usageMetadata?.totalTokenCount,
      }

      return {
        content,
        finishReason,
        usage,
        warnings: [] as LanguageModelV2CallWarning[],
      }
    },

    async doStream(options: LanguageModelV2CallOptions) {
      const generativeModel = vertex.getGenerativeModel({ model: modelId })
      const { system, contents } = toGeminiContents(options.prompt)

      const request: VertexRequest = {
        contents,
        generationConfig: {
          maxOutputTokens: options.maxOutputTokens,
          temperature: options.temperature,
          topP: options.topP,
          topK: options.topK,
          stopSequences: options.stopSequences,
        },
      }

      if (system) {
        request.systemInstruction = { parts: [{ text: system }] }
      }

      const streamResult = await generativeModel.generateContentStream(
        request as unknown as Parameters<
          typeof generativeModel.generateContentStream
        >[0],
      )

      const textBlockId = "text-0"
      let textStarted = false

      const readable = new ReadableStream<LanguageModelV2StreamPart>({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] })

          try {
            for await (const chunk of streamResult.stream) {
              const candidate = chunk.candidates?.[0]
              const parts = candidate?.content?.parts ?? []

              for (const part of parts) {
                const text = (part as { text?: string }).text
                if (text) {
                  if (!textStarted) {
                    controller.enqueue({ type: "text-start", id: textBlockId })
                    textStarted = true
                  }
                  controller.enqueue({
                    type: "text-delta",
                    id: textBlockId,
                    delta: text,
                  })
                }
              }
            }

            if (textStarted) {
              controller.enqueue({ type: "text-end", id: textBlockId })
            }

            // Aggregate final response for usage
            const aggregated = await streamResult.response
            const usageMetadata = aggregated.usageMetadata
            const lastCandidate = aggregated.candidates?.[0]

            controller.enqueue({
              type: "finish",
              finishReason: mapFinishReason(
                lastCandidate?.finishReason as string | undefined,
              ),
              usage: {
                inputTokens: usageMetadata?.promptTokenCount,
                outputTokens: usageMetadata?.candidatesTokenCount,
                totalTokens: usageMetadata?.totalTokenCount,
              },
            })
          } catch (err) {
            controller.enqueue({ type: "error", error: err })
          } finally {
            controller.close()
          }
        },
      })

      return { stream: readable }
    },
  }
}

// ── Effect-TS Service ─────────────────────────────────────────────────────────

export interface VertexAiProviderShape {
  /** Create a LanguageModelV2-compatible model for the given Vertex model ID. */
  model(modelId: VertexModelId): LanguageModelV2
}

export class VertexAiProvider extends Context.Service<VertexAiProvider, VertexAiProviderShape>()("@gco/infra-gcp/VertexAiProvider") {
  static readonly layer: Layer.Layer<
    VertexAiProvider,
    never,
    GcpConfig
  > = Layer.effect(
    VertexAiProvider,
    Effect.gen(function* () {
      const config = yield* GcpConfig
      const model = (modelId: VertexModelId): LanguageModelV2 =>
        vertexModel(modelId, config.projectId, config.region)
      return { model }
    }),
  )
}
