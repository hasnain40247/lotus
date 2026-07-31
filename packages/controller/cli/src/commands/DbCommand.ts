/**
 * DbCommand — database tools.
 *
 * For gcloud-opencode, the "database" is Firestore.
 * The path subcommand prints the Firestore project/collection info
 * instead of a SQLite file path.
 *
 * Subcommands:
 *   path — print Firestore project and collection configuration
 */

import type { CommandModule, Argv } from "yargs"
import { EOL } from "node:os"
import { Effect } from "effect"
import { GcpConfig } from "@gco/infra-gcp"
import { color } from "@gco/view-cli"
import { ProductionLayer } from "../bootstrap.js"

// ---------------------------------------------------------------------------
// path subcommand
// ---------------------------------------------------------------------------

const DbPathCommand: CommandModule<object, object> = {
  command: "path",
  describe: "print Firestore project and collection information",

  handler: async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* GcpConfig
        process.stdout.write(
          `Project:    ${color.bold(config.projectId)}` + EOL,
        )
        process.stdout.write(`Region:     ${config.region}` + EOL)
        process.stdout.write(
          `Collection: gco/sessions, gco/events, gco/credentials` + EOL,
        )
      }).pipe(
        Effect.catch((_err) => {
          // Fallback: print env var info when GCP config is not available
          process.stdout.write(
            `GCP Project: ${process.env.GCLOUD_OPENCODE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? "(not set)"}` + EOL,
          )
          return Effect.void
        }),
        Effect.provide(ProductionLayer),
      ),
    )
  },
}

// ---------------------------------------------------------------------------
// Top-level DbCommand
// ---------------------------------------------------------------------------

export const DbCommand: CommandModule<object, object> = {
  command: "db",
  describe: "database tools",

  builder: (yargs: Argv) =>
    yargs
      .command(DbPathCommand)
      .demandCommand(1, "Specify a subcommand: path"),

  handler: async () => {},
}
