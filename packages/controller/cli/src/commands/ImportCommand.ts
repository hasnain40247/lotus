/**
 * ImportCommand — import a session from a local file or gs:// URI.
 *
 * Calls SessionImporter and prints the resulting session ID to stdout.
 */

import type { CommandModule, Argv } from "yargs"
import { EOL } from "node:os"
import { Effect } from "effect"
import { color } from "@gco/view-cli"
import { SessionImporter } from "@gco/controller-session"
import { ProductionLayer } from "../bootstrap.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ImportArgs = {
  source: string
  session?: string
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function importHandler(args: ImportArgs): Promise<void> {
  await Effect.runPromise(
    Effect.gen(function* () {
      const importer = yield* SessionImporter

      process.stderr.write(`Importing from: ${args.source}${EOL}`)

      const result = yield* importer.import({
        source: args.source,
        targetSessionID: args.session as any,
      }).pipe(
        Effect.catch((err: unknown) =>
          Effect.fail(
            new Error(`Import failed: ${err instanceof Error ? err.message : String(err)}`),
          ),
        ),
      )

      process.stdout.write(`Imported session: ${result.sessionID}${EOL}`)
      process.stdout.write(
        color.gray(`Events imported: ${result.eventsImported}`) + EOL,
      )
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

export const ImportCommand: CommandModule<object, ImportArgs> = {
  command: "import <source>",
  describe: "import session data from a local file or gs:// URI",

  builder: (yargs: Argv) =>
    yargs
      .positional("source", {
        describe: "local file path or gs:// URI to import from",
        type: "string",
        demandOption: true,
      })
      .option("session", {
        alias: ["s"],
        describe: "target session ID (creates a new session if omitted)",
        type: "string",
      }) as unknown as Argv<ImportArgs>,

  handler: (args) => importHandler(args),
}
