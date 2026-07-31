/**
 * SessionExporter — builds a JSON or Markdown export of a session.
 *
 * Loads all durable events from IEventRepository, reconstructs the
 * conversation (messages + tool calls + results), serializes to JSON or
 * Markdown, uploads to GCS via IArtifactStore, and returns the gs:// URI.
 */

import { Context, Effect, Layer } from "effect"
import { Session, SessionMessage } from "@gco/schema"
import { EventRepository, SessionEvent, SessionRepository } from "@gco/model-domain"
import { GCSStorage } from "@gco/cloud/storage"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportFormat = "json" | "markdown"

export interface ExportInput {
  readonly sessionID: Session.ID
  readonly format?: ExportFormat
}

export interface ExportOutput {
  readonly uri: string
  readonly format: ExportFormat
}

// ---------------------------------------------------------------------------
// Interface & Tag
// ---------------------------------------------------------------------------

export interface Interface {
  readonly export: (input: ExportInput) => Effect.Effect<ExportOutput, Error>
}

export class SessionExporter extends Context.Service<SessionExporter, Interface>()(
  "@gco/SessionExporter",
) {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ConversationTurn {
  role: "user" | "assistant" | "system"
  content: string
  timestamp?: string
  tools?: ToolCallRecord[]
}

interface ToolCallRecord {
  name: string
  callID: string
  input: Record<string, unknown>
  status: "completed" | "error" | "pending"
  output?: string
  error?: string
}

interface ExportDocument {
  sessionID: string
  exportedAt: string
  conversation: ConversationTurn[]
}

/**
 * Project durable events into a simplified conversation structure
 * suitable for export.
 */
function buildConversation(events: SessionEvent.DurableEvent[]): ConversationTurn[] {
  const turns: ConversationTurn[] = []

  let currentAssistantTurn: ConversationTurn | undefined
  let textAccumulators = new Map<string, string>()
  let toolCallMap = new Map<string, ToolCallRecord>()

  function flushAssistant() {
    if (!currentAssistantTurn) return
    if (currentAssistantTurn.content.trim() !== "" || (currentAssistantTurn.tools?.length ?? 0) > 0) {
      turns.push(currentAssistantTurn)
    }
    currentAssistantTurn = undefined
    textAccumulators.clear()
    toolCallMap.clear()
  }

  function ensureAssistant(ts?: string) {
    if (!currentAssistantTurn) {
      currentAssistantTurn = {
        role: "assistant",
        content: "",
        timestamp: ts,
        tools: [],
      }
    }
  }

  for (const event of events) {
    const data = (event as unknown as { data: Record<string, unknown> }).data
    const type = event.type as string
    const ts = data["timestamp"] as string | undefined

    switch (type) {
      case "session.next.prompted":
      case "session.next.prompt.admitted": {
        flushAssistant()
        const prompt = data["prompt"] as { text?: string } | undefined
        turns.push({
          role: "user",
          content: prompt?.text ?? "",
          timestamp: ts,
        })
        break
      }

      case "session.next.synthetic":
      case "session.next.context.updated": {
        flushAssistant()
        turns.push({
          role: "user",
          content: (data["text"] as string) ?? "",
          timestamp: ts,
        })
        break
      }

      case "session.next.step.started": {
        ensureAssistant(ts)
        break
      }

      case "session.next.step.ended":
      case "session.next.step.failed": {
        flushAssistant()
        break
      }

      case "session.next.text.started": {
        ensureAssistant(ts)
        const textID = (data["textID"] as string) ?? ""
        textAccumulators.set(textID, "")
        break
      }

      case "session.next.text.ended": {
        const textID = (data["textID"] as string) ?? ""
        const text = (data["text"] as string) ?? textAccumulators.get(textID) ?? ""
        textAccumulators.delete(textID)
        if (currentAssistantTurn) {
          currentAssistantTurn.content +=
            currentAssistantTurn.content.length > 0 ? "\n" + text : text
        }
        break
      }

      case "session.next.tool.called": {
        ensureAssistant(ts)
        const callID = (data["callID"] as string) ?? ""
        const toolName = (data["tool"] as string) ?? (data["name"] as string) ?? "unknown"
        const toolInput = (data["input"] as Record<string, unknown>) ?? {}
        const record: ToolCallRecord = {
          name: toolName,
          callID,
          input: toolInput,
          status: "pending",
        }
        toolCallMap.set(callID, record)
        currentAssistantTurn!.tools!.push(record)
        break
      }

      case "session.next.tool.success": {
        const callID = (data["callID"] as string) ?? ""
        const record = toolCallMap.get(callID)
        if (record) {
          record.status = "completed"
          const content = data["content"] as Array<{ type: string; text?: string }> | undefined
          const text = content
            ?.filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("\n")
          record.output = text ?? JSON.stringify(data["structured"] ?? {})
        }
        break
      }

      case "session.next.tool.failed": {
        const callID = (data["callID"] as string) ?? ""
        const record = toolCallMap.get(callID)
        if (record) {
          record.status = "error"
          const error = data["error"] as { message?: string } | undefined
          record.error = error?.message ?? "Unknown error"
        }
        break
      }

      case "session.next.compaction.ended": {
        flushAssistant()
        const summary = (data["text"] as string) ?? ""
        const recent = (data["recent"] as string) ?? ""
        turns.push({
          role: "system",
          content: `[Compaction]\n${summary}\n\nRecent context:\n${recent}`,
          timestamp: ts,
        })
        break
      }

      default:
        break
    }
  }

  flushAssistant()
  return turns
}

/**
 * Render a conversation to Markdown.
 */
function toMarkdown(sessionID: string, turns: ConversationTurn[]): string {
  const lines: string[] = [
    `# Session Export`,
    ``,
    `**Session ID:** \`${sessionID}\``,
    `**Exported at:** ${new Date().toISOString()}`,
    ``,
    `---`,
    ``,
  ]

  for (const turn of turns) {
    const roleLabel =
      turn.role === "user"
        ? "**User**"
        : turn.role === "assistant"
          ? "**Assistant**"
          : "**System**"

    if (turn.timestamp) {
      lines.push(`${roleLabel} *(${turn.timestamp})*`)
    } else {
      lines.push(roleLabel)
    }
    lines.push(``)
    lines.push(turn.content)
    lines.push(``)

    if (turn.tools && turn.tools.length > 0) {
      for (const tool of turn.tools) {
        lines.push(`<details>`)
        lines.push(`<summary>Tool: <code>${tool.name}</code> — ${tool.status}</summary>`)
        lines.push(``)
        lines.push(`**Input:**`)
        lines.push(`\`\`\`json`)
        lines.push(JSON.stringify(tool.input, null, 2))
        lines.push(`\`\`\``)
        if (tool.output !== undefined) {
          lines.push(``)
          lines.push(`**Output:**`)
          lines.push(`\`\`\``)
          lines.push(tool.output)
          lines.push(`\`\`\``)
        }
        if (tool.error !== undefined) {
          lines.push(``)
          lines.push(`**Error:** ${tool.error}`)
        }
        lines.push(`</details>`)
        lines.push(``)
      }
    }

    lines.push(`---`)
    lines.push(``)
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const layer: Layer.Layer<
  SessionExporter,
  never,
  EventRepository | SessionRepository | GCSStorage
> = Layer.effect(
  SessionExporter,
  Effect.gen(function* () {
    const eventRepo = yield* EventRepository
    const sessions = yield* SessionRepository
    const storage = yield* GCSStorage

    return SessionExporter.of({
      export: Effect.fn("SessionExporter.export")(function* (input) {
        const format = input.format ?? "json"

        // Verify session exists
        const session = yield* sessions.get(input.sessionID)
        if (session === undefined) {
          return yield* Effect.fail(new Error(`Session not found: ${input.sessionID}`))
        }

        // Load all events
        const events = yield* eventRepo.load(input.sessionID)

        // Build conversation
        const conversation = buildConversation(events)

        // Serialize
        const now = new Date().toISOString()
        let data: Buffer
        let mime: string
        let ext: string

        if (format === "json") {
          const doc: ExportDocument = {
            sessionID: input.sessionID,
            exportedAt: now,
            conversation,
          }
          data = Buffer.from(JSON.stringify(doc, null, 2), "utf-8")
          mime = "application/json"
          ext = "json"
        } else {
          const markdown = toMarkdown(input.sessionID, conversation)
          data = Buffer.from(markdown, "utf-8")
          mime = "text/markdown"
          ext = "md"
        }

        // Upload to GCS
        const key = `sessions/${input.sessionID}/export-${now.replace(/[:.]/g, "-")}.${ext}`
        const uri = yield* storage.write(key, data, mime)

        return { uri, format }
      }),
    })
  }),
)
