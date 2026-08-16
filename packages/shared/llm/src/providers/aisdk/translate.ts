import { jsonSchema, tool, type ModelMessage, type ToolSet } from "ai"
import {
  LLMEvent,
  type ContentPart,
  type FinishReason,
  type LLMRequest,
  type Message,
  type SystemPart,
  type ToolChoice,
  type ToolDefinition,
  type ToolResultValue,
  Usage,
} from "../../schema"

// ---------------------------------------------------------------------------
// Request → AI SDK streamText args
// ---------------------------------------------------------------------------

export interface StreamTextRequestArgs {
  readonly system: string | undefined
  readonly messages: ModelMessage[]
  readonly tools: ToolSet | undefined
  readonly toolChoice:
    | "auto"
    | "none"
    | "required"
    | { readonly type: "tool"; readonly toolName: string }
    | undefined
  readonly temperature: number | undefined
  readonly topP: number | undefined
  readonly topK: number | undefined
  readonly maxOutputTokens: number | undefined
  readonly stopSequences: string[] | undefined
  readonly seed: number | undefined
  readonly presencePenalty: number | undefined
  readonly frequencyPenalty: number | undefined
  readonly headers: Record<string, string> | undefined
}

const systemToString = (parts: readonly SystemPart[]): string | undefined => {
  if (parts.length === 0) return undefined
  return parts.map((part) => part.text).join("\n\n")
}

const toolResultOutput = (result: ToolResultValue) => {
  switch (result.type) {
    case "text":
      return { type: "text" as const, value: String(result.value ?? "") }
    case "json":
      return { type: "json" as const, value: result.value as never }
    case "error":
      return { type: "error-json" as const, value: result.value as never }
    case "content":
      return {
        type: "content" as const,
        value: result.value.map((item) =>
          item.type === "text"
            ? { type: "text" as const, text: item.text }
            : { type: "file" as const, mediaType: item.mime, data: { type: "url" as const, url: new URL(item.uri) } },
        ),
      }
  }
}

const contentPart = (part: ContentPart) => {
  switch (part.type) {
    case "text":
      return { type: "text" as const, text: part.text }
    case "reasoning":
      return { type: "reasoning" as const, text: part.text }
    case "media":
      return { type: "file" as const, mediaType: part.mediaType, data: part.data, filename: part.filename }
    case "tool-call":
      return {
        type: "tool-call" as const,
        toolCallId: part.id,
        toolName: part.name,
        input: part.input,
        providerExecuted: part.providerExecuted,
      }
    case "tool-result":
      return {
        type: "tool-result" as const,
        toolCallId: part.id,
        toolName: part.name,
        output: toolResultOutput(part.result),
        providerExecuted: part.providerExecuted,
      }
  }
}

const messageToAISDK = (message: Message): ModelMessage => {
  switch (message.role) {
    case "system": {
      const text = message.content
        .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("")
      return { role: "system", content: text }
    }
    case "user":
      return {
        role: "user",
        content: message.content
          .filter((p) => p.type === "text" || p.type === "media")
          .map(contentPart) as ModelMessage extends { role: "user"; content: infer C } ? C : never,
      }
    case "assistant":
      return {
        role: "assistant",
        content: message.content.map(contentPart) as ModelMessage extends {
          role: "assistant"
          content: infer C
        }
          ? C
          : never,
      }
    case "tool":
      return {
        role: "tool",
        content: message.content
          .filter((p) => p.type === "tool-result")
          .map(contentPart) as ModelMessage extends { role: "tool"; content: infer C } ? C : never,
      }
  }
}

const toolsToAISDK = (defs: readonly ToolDefinition[]): ToolSet | undefined => {
  if (defs.length === 0) return undefined
  const set: ToolSet = {}
  for (const def of defs) {
    set[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.inputSchema as never),
    })
  }
  return set
}

const toolChoiceToAISDK = (choice: ToolChoice | undefined) => {
  if (!choice) return undefined
  switch (choice.type) {
    case "auto":
    case "none":
    case "required":
      return choice.type
    case "tool":
      return choice.name ? ({ type: "tool" as const, toolName: choice.name }) : undefined
  }
}

export const requestToStreamTextArgs = (request: LLMRequest): StreamTextRequestArgs => {
  const gen = request.generation
  return {
    system: systemToString(request.system),
    messages: request.messages.map(messageToAISDK),
    tools: toolsToAISDK(request.tools),
    toolChoice: toolChoiceToAISDK(request.toolChoice),
    temperature: gen?.temperature,
    topP: gen?.topP,
    topK: gen?.topK,
    maxOutputTokens: gen?.maxTokens,
    stopSequences: gen?.stop ? [...gen.stop] : undefined,
    seed: gen?.seed,
    presencePenalty: gen?.presencePenalty,
    frequencyPenalty: gen?.frequencyPenalty,
    headers: request.http?.headers,
  }
}

// ---------------------------------------------------------------------------
// AI SDK stream part → LLMEvent(s)
// ---------------------------------------------------------------------------

const finishReasonToLLM = (reason: string | undefined): FinishReason => {
  switch (reason) {
    case "stop":
    case "length":
    case "tool-calls":
    case "content-filter":
    case "error":
      return reason
    default:
      return "unknown"
  }
}

interface AISDKUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly inputTokenDetails?: {
    readonly noCacheTokens?: number
    readonly cacheReadTokens?: number
    readonly cacheWriteTokens?: number
  }
  readonly outputTokenDetails?: {
    readonly reasoningTokens?: number
  }
}

const usageToLLM = (usage: AISDKUsage | undefined): Usage | undefined => {
  if (!usage) return undefined
  return new Usage({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    nonCachedInputTokens: usage.inputTokenDetails?.noCacheTokens,
    cacheReadInputTokens: usage.inputTokenDetails?.cacheReadTokens,
    cacheWriteInputTokens: usage.inputTokenDetails?.cacheWriteTokens,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
    totalTokens: usage.totalTokens,
  })
}

/**
 * Translate one AI SDK `fullStream` part into zero, one, or more `LLMEvent`s.
 * `toolNames` maps tool-call ID → toolName (populated on `tool-input-start`,
 * since `tool-input-delta`/`tool-input-end` frames from the AI SDK don't carry
 * the tool name but our LLMEvent schema requires it).
 */
export const streamPartToLLMEvent = (
  part: { readonly type: string; readonly [key: string]: unknown },
  stepIndex: number,
  toolNames: Map<string, string>,
): LLMEvent | ReadonlyArray<LLMEvent> | undefined => {
  const p = part as never as {
    type: string
    id?: string
    text?: string
    delta?: string
    toolName?: string
    toolCallId?: string
    input?: unknown
    finishReason?: string
    usage?: AISDKUsage
    totalUsage?: AISDKUsage
    providerMetadata?: Record<string, Record<string, unknown>>
    providerExecuted?: boolean
    error?: unknown
  }
  switch (part.type) {
    case "start":
    case "start-step":
      return LLMEvent.stepStart({ index: stepIndex })
    case "text-start":
      return LLMEvent.textStart({ id: p.id ?? "", providerMetadata: p.providerMetadata })
    case "text-delta":
      return LLMEvent.textDelta({ id: p.id ?? "", text: p.text ?? "", providerMetadata: p.providerMetadata })
    case "text-end":
      return LLMEvent.textEnd({ id: p.id ?? "", providerMetadata: p.providerMetadata })
    case "reasoning-start":
      return LLMEvent.reasoningStart({ id: p.id ?? "", providerMetadata: p.providerMetadata })
    case "reasoning-delta":
      return LLMEvent.reasoningDelta({ id: p.id ?? "", text: p.text ?? "", providerMetadata: p.providerMetadata })
    case "reasoning-end":
      return LLMEvent.reasoningEnd({ id: p.id ?? "", providerMetadata: p.providerMetadata })
    case "tool-input-start": {
      if (p.id && p.toolName) toolNames.set(p.id, p.toolName)
      return LLMEvent.toolInputStart({
        id: p.id ?? "",
        name: p.toolName ?? "",
        providerMetadata: p.providerMetadata,
      })
    }
    case "tool-input-delta":
      return LLMEvent.toolInputDelta({
        id: p.id ?? "",
        name: toolNames.get(p.id ?? "") ?? "",
        text: p.delta ?? "",
      })
    case "tool-input-end":
      return LLMEvent.toolInputEnd({
        id: p.id ?? "",
        name: toolNames.get(p.id ?? "") ?? "",
        providerMetadata: p.providerMetadata,
      })
    case "tool-call":
      return LLMEvent.toolCall({
        id: p.toolCallId ?? "",
        name: p.toolName ?? "",
        input: p.input,
        providerExecuted: p.providerExecuted,
        providerMetadata: p.providerMetadata,
      })
    case "finish-step":
      return LLMEvent.stepFinish({
        index: stepIndex,
        reason: finishReasonToLLM(p.finishReason),
        usage: usageToLLM(p.usage),
        providerMetadata: p.providerMetadata,
      })
    case "finish":
      return LLMEvent.finish({
        reason: finishReasonToLLM(p.finishReason),
        usage: usageToLLM(p.totalUsage),
      })
    case "error":
      return LLMEvent.providerError({
        message: p.error instanceof Error ? p.error.message : String(p.error ?? "provider error"),
      })
    default:
      return undefined
  }
}
