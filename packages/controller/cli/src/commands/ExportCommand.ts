/**
 * ExportCommand — export a session to GCS.
 *
 * Calls SessionExporter and prints the resulting gs:// URI to stdout.
 */

import type { CommandModule, Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { EOL } from "node:os"
import { Effect } from "effect"
import { color } from "@gco/view-cli"
import { SessionExporter, SessionController } from "@gco/controller-session"
import type { Session } from "@gco/schema"
import { ProductionLayer } from "../bootstrap.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportArgs = {
  sessionID?: string
  format?: string
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function exportHandler(args: ExportArgs): Promise<void> {
  await Effect.runPromise(
    Effect.gen(function* () {
      const exporter = yield* SessionExporter
      const controller = yield* SessionController

      let sessionID = args.sessionID as Session.ID | undefined

      if (!sessionID) {
        // Let user pick from a list
        process.stderr.write(EOL)
        prompts.intro("Export session")

        const sessions = yield* controller.list("default").pipe(
          Effect.catch(() => Effect.succeed([] as Session.Info[])),
        )

        if (sessions.length === 0) {
          prompts.log.error("No sessions found")
          prompts.outro("Done")
          return
        }

        const sorted = sessions.slice().sort((a, b) => {
          const aMs = typeof a.time.updated === "number"
            ? a.time.updated
            : (a.time.updated as any).epochMillis ?? 0
          const bMs = typeof b.time.updated === "number"
            ? b.time.updated
            : (b.time.updated as any).epochMillis ?? 0
          return bMs - aMs
        })

        const selected = yield* Effect.promise(() =>
          prompts.select({
            message: "Select session to export",
            options: sorted.map((s) => ({
              label: s.title,
              value: String(s.id),
              hint: new Date(
                typeof s.time.updated === "number"
                  ? s.time.updated
                  : (s.time.updated as any).epochMillis ?? Date.now(),
              ).toLocaleString(),
            })),
          }),
        )

        if (prompts.isCancel(selected)) {
          prompts.outro("Cancelled")
          return
        }

        sessionID = selected as unknown as Session.ID
        prompts.outro("Exporting...")
      }

      process.stderr.write(`Exporting session: ${sessionID}${EOL}`)

      const result = yield* exporter.export({
        sessionID: sessionID!,
        format: (args.format as "json" | "markdown") ?? "json",
      }).pipe(
        Effect.catch((err: unknown) =>
          Effect.fail(new Error(`Export failed: ${err instanceof Error ? err.message : String(err)}`)),
        ),
      )

      process.stdout.write(result.uri + EOL)
    }).pipe(
      Effect.catch((err: unknown) => {
        process.stderr.write(
          color.red("Error: ") +
            (err instanceof Error ? err.message : String(err)) +
            EOL,
        )
        process.exitCode = 1
        return Effect.void
      }),
      Effect.provide(ProductionLayer),
    ),
  )
}

// ---------------------------------------------------------------------------
// Command export
// ---------------------------------------------------------------------------

export const ExportCommand: CommandModule<object, ExportArgs> = {
  command: "export [sessionID]",
  describe: "export session data to GCS",

  builder: (yargs: Argv) =>
    yargs
      .positional("sessionID", {
        describe: "session ID to export (interactive picker if omitted)",
        type: "string",
      })
      .option("format", {
        describe: "export format",
        type: "string",
        choices: ["json", "markdown"],
        default: "json",
      }) as unknown as Argv<ExportArgs>,

  handler: (args) => exportHandler(args),
}
