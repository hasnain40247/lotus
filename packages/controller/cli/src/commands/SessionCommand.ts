/**
 * SessionCommand — manage sessions.
 *
 * Subcommands:
 *   list   — list sessions
 *   delete — delete a session by ID
 */

import type { CommandModule, Argv } from "yargs"
import { EOL } from "node:os"
import { Effect } from "effect"
import { formatSessionList, formatSessionDetail, color, type SessionInfo } from "@gco/view-cli"
import { SessionController, NotFoundError } from "@gco/controller-session"
import { SessionRepository } from "@gco/model-domain"
import type { Session } from "@gco/schema"
import { ProductionLayer } from "../bootstrap.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSessionInfo(session: Session.Info): SessionInfo {
  const updatedMs =
    typeof session.time.updated === "number"
      ? session.time.updated
      : (session.time.updated as any).epochMillis ?? Date.now()
  const createdMs =
    typeof session.time.created === "number"
      ? session.time.created
      : (session.time.created as any).epochMillis ?? Date.now()

  return {
    id: String(session.id),
    title: session.title,
    agent: session.agent,
    model:
      session.model
        ? `${session.model.providerID}/${session.model.id}`
        : undefined,
    cost: session.cost ?? 0,
    tokens: {
      input: session.tokens?.input ?? 0,
      output: session.tokens?.output ?? 0,
      reasoning: session.tokens?.reasoning ?? 0,
    },
    createdAt: createdMs,
    updatedAt: updatedMs,
  }
}

// ---------------------------------------------------------------------------
// list subcommand
// ---------------------------------------------------------------------------

type ListArgs = {
  format: string
  "max-count"?: number
  maxCount?: number
}

const SessionListCommand: CommandModule<object, ListArgs> = {
  command: "list",
  aliases: ["ls"],
  describe: "list sessions",

  builder: (yargs: Argv) =>
    yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }) as unknown as Argv<ListArgs>,

  handler: async (args) => {
    const limit = args["max-count"] ?? args.maxCount

    await Effect.runPromise(
      Effect.gen(function* () {
        const controller = yield* SessionController
        const sessions = yield* controller.list("default").pipe(
          Effect.catch(() => Effect.succeed([] as Session.Info[])),
        )

        const sorted = sessions
          .slice()
          .sort((a, b) => {
            const aMs = typeof a.time.updated === "number"
              ? a.time.updated
              : (a.time.updated as any).epochMillis ?? 0
            const bMs = typeof b.time.updated === "number"
              ? b.time.updated
              : (b.time.updated as any).epochMillis ?? 0
            return bMs - aMs
          })
          .slice(0, limit)

        if (args.format === "json") {
          process.stdout.write(
            JSON.stringify(
              sorted.map((s) => ({
                id: String(s.id),
                title: s.title,
                agent: s.agent,
                model: s.model ? `${s.model.providerID}/${s.model.id}` : null,
                cost: s.cost,
                tokens: s.tokens,
                createdAt:
                  typeof s.time.created === "number"
                    ? s.time.created
                    : (s.time.created as any).epochMillis,
                updatedAt:
                  typeof s.time.updated === "number"
                    ? s.time.updated
                    : (s.time.updated as any).epochMillis,
              })),
              null,
              2,
            ) + EOL,
          )
          return
        }

        process.stdout.write(
          formatSessionList(sorted.map(toSessionInfo)) + EOL,
        )
      }).pipe(Effect.provide(ProductionLayer)),
    )
  },
}

// ---------------------------------------------------------------------------
// delete subcommand
// ---------------------------------------------------------------------------

type DeleteArgs = { sessionID: string }

const SessionDeleteCommand: CommandModule<object, DeleteArgs> = {
  command: "delete <sessionID>",
  describe: "delete a session",

  builder: (yargs: Argv) =>
    yargs.positional("sessionID", {
      describe: "session ID to delete",
      type: "string",
      demandOption: true,
    }) as unknown as Argv<DeleteArgs>,

  handler: async (args) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const controller = yield* SessionController

        const sessionRepo = yield* SessionRepository

        // Verify it exists first
        yield* controller
          .get(args.sessionID as unknown as Session.ID)
          .pipe(
            Effect.catch((err: unknown) =>
              err instanceof NotFoundError
                ? Effect.fail(new Error(`Session not found: ${args.sessionID}`))
                : Effect.fail(err instanceof Error ? err : new Error(String(err))),
            ),
          )

        // Interrupt any running turn, then archive the session
        yield* controller
          .interrupt(args.sessionID as unknown as Session.ID)
          .pipe(Effect.catchCause(() => Effect.void))
        yield* sessionRepo.archive(args.sessionID as unknown as Session.ID)

        process.stdout.write(`Deleted session ${args.sessionID}` + EOL)
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
  },
}

// ---------------------------------------------------------------------------
// Top-level SessionCommand
// ---------------------------------------------------------------------------

export const SessionCommand: CommandModule<object, object> = {
  command: "session",
  describe: "manage sessions",

  builder: (yargs: Argv) =>
    yargs
      .command(SessionListCommand)
      .command(SessionDeleteCommand)
      .demandCommand(1, "Specify a subcommand: list, delete"),

  handler: async () => {},
}
