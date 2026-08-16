import { Logging } from "@google-cloud/logging"
import { Context, Effect, Layer } from "effect"
import { GcpConfig } from "../config"

// ── Severity ─────────────────────────────────────────────────────────────────

export type LogSeverity =
  | "DEFAULT"
  | "DEBUG"
  | "INFO"
  | "NOTICE"
  | "WARNING"
  | "ERROR"
  | "CRITICAL"
  | "ALERT"
  | "EMERGENCY"

// ── Service shape ─────────────────────────────────────────────────────────────

export interface CloudLoggerShape {
  /**
   * Write a structured log entry to Cloud Logging.
   *
   * @param severity - One of the Cloud Logging severity levels.
   * @param message  - Human-readable log message.
   * @param metadata - Arbitrary key/value pairs to include in the JSON payload.
   */
  log(
    severity: LogSeverity,
    message: string,
    metadata?: Record<string, unknown>,
  ): Effect.Effect<void, Error>
}

// ── Service ───────────────────────────────────────────────────────────────────

export class CloudLogger extends Context.Service<CloudLogger, CloudLoggerShape>()("@gco/cloud/CloudLogger") {
  static readonly layer: Layer.Layer<
    CloudLogger,
    never,
    GcpConfig
  > = Layer.effect(
    CloudLogger,
    Effect.gen(function* () {
      const config = yield* GcpConfig

      const logging = new Logging({ projectId: config.projectId })
      // Log name follows the pattern: "projects/{projectId}/logs/neko"
      const logInstance = logging.log("neko")

      const log = (
        severity: LogSeverity,
        message: string,
        metadata: Record<string, unknown> = {},
      ): Effect.Effect<void, Error> =>
        Effect.tryPromise({
          try: async () => {
            const entry = logInstance.entry(
              {
                severity,
                resource: { type: "global" },
              },
              {
                message,
                ...metadata,
              },
            )
            await logInstance.write(entry)
          },
          catch: (cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
        })

      return { log }
    }),
  )
}
