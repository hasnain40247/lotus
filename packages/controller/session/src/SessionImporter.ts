/**
 * SessionImporter — reverse of SessionExporter.
 *
 * Reads an export file (local path or gs:// URI), parses the JSON,
 * replays events into IEventRepository for a new or existing session,
 * and returns the target session ID.
 */

import { Context, DateTime, Effect, Layer } from "effect"
import { Session, SessionMessage } from "@gco/schema"
import { EventRepository, SessionEvent, SessionRepository } from "@gco/model-domain"
import { GCSStorage } from "@gco/cloud/storage"
import { readFile } from "node:fs/promises"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportInput {
  /**
   * Source: a local file path or a gs:// URI produced by SessionExporter.
   */
  readonly source: string
  /**
   * Target session to import into. If undefined, a new session ID is created.
   */
  readonly targetSessionID?: Session.ID
  /**
   * If true and targetSessionID already has events, the import is rejected.
   * Defaults to false (append / idempotent replay).
   */
  readonly failIfExists?: boolean
}

export interface ImportOutput {
  readonly sessionID: Session.ID
  readonly eventsImported: number
}

// ---------------------------------------------------------------------------
// Interface & Tag
// ---------------------------------------------------------------------------

export interface Interface {
  readonly import: (input: ImportInput) => Effect.Effect<ImportOutput, Error>
}

export class SessionImporter extends Context.Service<SessionImporter, Interface>()(
  "@gco/SessionImporter",
) {}

// ---------------------------------------------------------------------------
// Export document shape (must match SessionExporter)
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse raw bytes into an ExportDocument.
 */
function parseDocument(data: Buffer): ExportDocument {
  const text = data.toString("utf-8")
  const doc = JSON.parse(text) as unknown

  if (
    typeof doc !== "object" ||
    doc === null ||
    typeof (doc as Record<string, unknown>)["sessionID"] !== "string" ||
    !Array.isArray((doc as Record<string, unknown>)["conversation"])
  ) {
    throw new Error("Invalid export document format")
  }

  return doc as ExportDocument
}

/**
 * Convert an ExportDocument's conversation turns into durable SessionEvents
 * that can be appended to IEventRepository.
 *
 * We synthesize a minimal event sequence that will allow the history projector
 * in SessionRunner to reconstruct the conversation.
 */
function documentToEvents(
  doc: ExportDocument,
  targetSessionID: Session.ID,
): SessionEvent.DurableEvent[] {
  const events: SessionEvent.DurableEvent[] = []

  const makeID = () =>
    SessionMessage.ID.create() as unknown as SessionEvent.DurableEvent["id"]

  const durable = undefined as unknown as SessionEvent.DurableEvent["durable"]

  const now = DateTime.makeUnsafe(Date.now())

  for (const turn of doc.conversation) {
    const ts = turn.timestamp ? DateTime.makeUnsafe(new Date(turn.timestamp).getTime()) : now

    if (turn.role === "user") {
      events.push({
        id: makeID(),
        type: "session.next.prompt.admitted",
        durable,
        data: {
          sessionID: targetSessionID,
          timestamp: ts,
          messageID: SessionMessage.ID.create(),
          prompt: { text: turn.content, files: [], agents: [] },
          delivery: "steer",
        },
      } as unknown as SessionEvent.DurableEvent)
      continue
    }

    if (turn.role === "system") {
      events.push({
        id: makeID(),
        type: "session.next.context.updated",
        durable,
        data: {
          sessionID: targetSessionID,
          timestamp: ts,
          messageID: SessionMessage.ID.create(),
          text: turn.content,
        },
      } as unknown as SessionEvent.DurableEvent)
      continue
    }

    if (turn.role === "assistant") {
      const assistantMessageID = SessionMessage.ID.create()
      const model = {
        id: "imported",
        providerID: "imported",
      }

      // Step.Started
      events.push({
        id: makeID(),
        type: "session.next.step.started",
        durable,
        data: {
          sessionID: targetSessionID,
          timestamp: ts,
          assistantMessageID,
          agent: "imported",
          model,
          snapshot: undefined,
        },
      } as unknown as SessionEvent.DurableEvent)

      // Text content
      if (turn.content.trim().length > 0) {
        const textID = "text_" + assistantMessageID
        events.push({
          id: makeID(),
          type: "session.next.text.started",
          durable,
          data: {
            sessionID: targetSessionID,
            timestamp: ts,
            assistantMessageID,
            textID,
          },
        } as unknown as SessionEvent.DurableEvent)

        events.push({
          id: makeID(),
          type: "session.next.text.ended",
          durable,
          data: {
            sessionID: targetSessionID,
            timestamp: ts,
            assistantMessageID,
            textID,
            text: turn.content,
          },
        } as unknown as SessionEvent.DurableEvent)
      }

      // Tool calls
      for (const tool of turn.tools ?? []) {
        const callID = tool.callID || SessionMessage.ID.create()

        // Tool.Input.Started
        events.push({
          id: makeID(),
          type: "session.next.tool.input.started",
          durable,
          data: {
            sessionID: targetSessionID,
            timestamp: ts,
            assistantMessageID,
            callID,
            name: tool.name,
          },
        } as unknown as SessionEvent.DurableEvent)

        // Tool.Input.Ended
        events.push({
          id: makeID(),
          type: "session.next.tool.input.ended",
          durable,
          data: {
            sessionID: targetSessionID,
            timestamp: ts,
            assistantMessageID,
            callID,
            text: JSON.stringify(tool.input),
          },
        } as unknown as SessionEvent.DurableEvent)

        // Tool.Called
        events.push({
          id: makeID(),
          type: "session.next.tool.called",
          durable,
          data: {
            sessionID: targetSessionID,
            timestamp: ts,
            assistantMessageID,
            callID,
            tool: tool.name,
            input: tool.input,
            provider: { executed: false },
          },
        } as unknown as SessionEvent.DurableEvent)

        if (tool.status === "completed" && tool.error === undefined) {
          // Tool.Success
          events.push({
            id: makeID(),
            type: "session.next.tool.success",
            durable,
            data: {
              sessionID: targetSessionID,
              timestamp: ts,
              assistantMessageID,
              callID,
              structured: {},
              content: tool.output !== undefined ? [{ type: "text", text: tool.output }] : [],
              provider: { executed: false },
            },
          } as unknown as SessionEvent.DurableEvent)
        } else if (tool.status === "error" || tool.error !== undefined) {
          // Tool.Failed
          events.push({
            id: makeID(),
            type: "session.next.tool.failed",
            durable,
            data: {
              sessionID: targetSessionID,
              timestamp: ts,
              assistantMessageID,
              callID,
              error: { type: "unknown", message: tool.error ?? "Unknown error" },
              provider: { executed: false },
            },
          } as unknown as SessionEvent.DurableEvent)
        }
      }

      // Step.Ended
      events.push({
        id: makeID(),
        type: "session.next.step.ended",
        durable,
        data: {
          sessionID: targetSessionID,
          timestamp: ts,
          assistantMessageID,
          finish: "end_turn",
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          snapshot: undefined,
          files: undefined,
        },
      } as unknown as SessionEvent.DurableEvent)
    }
  }

  return events
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const layer: Layer.Layer<
  SessionImporter,
  never,
  EventRepository | SessionRepository | GCSStorage
> = Layer.effect(
  SessionImporter,
  Effect.gen(function* () {
    const eventRepo = yield* EventRepository
    const sessions = yield* SessionRepository
    const storage = yield* GCSStorage

    return SessionImporter.of({
      import: Effect.fn("SessionImporter.import")(function* (input) {
        // Determine target session ID
        const targetSessionID = input.targetSessionID ?? Session.ID.create()

        // Check if target session already has events
        if (input.failIfExists) {
          const existing = yield* eventRepo.load(targetSessionID)
          if (existing.length > 0) {
            return yield* Effect.fail(
              new Error(
                `Session ${targetSessionID} already has ${existing.length} events; ` +
                  `set failIfExists: false to allow append.`,
              ),
            )
          }
        }

        // Read the source data
        let rawData: Buffer

        if (input.source.startsWith("gs://")) {
          rawData = yield* storage.read(input.source)
        } else {
          rawData = yield* Effect.tryPromise({
            try: () => readFile(input.source),
            catch: (cause) =>
              cause instanceof Error
                ? cause
                : new Error(`Failed to read ${input.source}: ${String(cause)}`),
          })
        }

        // Parse the export document
        const doc = yield* Effect.try({
          try: () => parseDocument(rawData),
          catch: (cause) =>
            cause instanceof Error
              ? cause
              : new Error(`Failed to parse export document: ${String(cause)}`),
        })

        // Convert to durable events
        const events = yield* Effect.try({
          try: () => documentToEvents(doc, targetSessionID),
          catch: (cause) =>
            cause instanceof Error
              ? cause
              : new Error(`Failed to convert export document to events: ${String(cause)}`),
        })

        // Create the session record if it does not exist yet
        const existingSession = yield* sessions.get(targetSessionID)
        if (existingSession === undefined) {
          const now = Date.now()
          yield* sessions.create({
            id: targetSessionID,
            projectID: "imported" as Session.Info["projectID"],
            title: `Imported session from ${input.source}`,
            agent: undefined,
            model: undefined,
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            time: {
              created: DateTime.makeUnsafe(now),
              updated: DateTime.makeUnsafe(now),
            },
            location: {
              directory: "/" as Session.Info["location"]["directory"],
            },
            parentID: undefined,
            subpath: undefined,
            revert: undefined,
          } satisfies Session.Info)
        }

        // Append events to the repository
        if (events.length > 0) {
          yield* eventRepo.append(targetSessionID, events)
        }

        return {
          sessionID: targetSessionID,
          eventsImported: events.length,
        }
      }),
    })
  }),
)
