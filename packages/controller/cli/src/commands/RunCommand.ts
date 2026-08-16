/**
 * RunCommand — non-interactive `neko run` command.
 *
 * Accepts a prompt string, creates or continues a session, streams
 * tool-use and text output to stdout, then exits when the session goes idle.
 *
 * Options: --model, --session, --continue, --fork, --format json,
 *          --agent, --title, --file, --thinking, --auto
 */

import type { CommandModule, Argv } from "yargs"
import path from "node:path"
import { EOL } from "node:os"
import { Effect } from "effect"
import { color } from "@gco/view-cli"
import { SessionController } from "@gco/controller-session"
import { ProductionLayer } from "../bootstrap.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveModel(value?: string): { providerID: string; id: string } | undefined {
  if (!value) return undefined
  const parts = value.split("/")
  const providerID = parts[0] as string
  const id = parts.slice(1).join("/")
  return { providerID, id }
}

async function resolveStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  return Bun.stdin.text()
}

function resolveMessage(message: string[], piped?: string): string {
  const base = message
    .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
    .join(" ")
  if (!piped) return base
  if (!base) return piped
  return base + "\n" + piped
}

// ---------------------------------------------------------------------------
// Command types
// ---------------------------------------------------------------------------

type RunArgs = {
  message: string[]
  "--"?: string[]
  command?: string
  continue?: boolean
  session?: string
  fork?: boolean
  model?: string
  agent?: string
  format: string
  file?: string[]
  title?: string
  dir?: string
  variant?: string
  thinking?: boolean
  auto: boolean
  yolo: boolean
  "dangerously-skip-permissions": boolean
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function runHandler(args: RunArgs): Promise<void> {
  const die = (message: string): never => {
    process.stderr.write(color.red("Error: ") + message + EOL)
    process.exit(1)
  }

  const piped = await resolveStdin()
  const rawMessage = [...args.message, ...(args["--"] ?? [])].join(" ")
  const message = resolveMessage([...args.message, ...(args["--"] ?? [])], piped)

  if (!message.trim() && !args.command) {
    die("You must provide a message or a --command")
  }

  if (args.fork && !args.continue && !args.session) {
    die("--fork requires --continue or --session")
  }

  const autoApprove = args.auto || args.yolo || args["dangerously-skip-permissions"]
  const useJsonFormat = args.format === "json"

  const directory = args.dir
    ? path.isAbsolute(args.dir)
      ? args.dir
      : path.resolve(process.cwd(), args.dir)
    : (process.env.PWD ?? process.cwd())

  function emit(type: string, data: Record<string, unknown>): boolean {
    if (!useJsonFormat) return false
    process.stdout.write(
      JSON.stringify({ type, timestamp: Date.now(), ...data }) + EOL,
    )
    return true
  }

  const program = Effect.gen(function* () {
    const controller = yield* SessionController

    // Resolve the session to use
    let sessionID: string

    if (args.session) {
      // Use specific session by ID
      const existing = yield* controller.get(args.session as any).pipe(
        Effect.catch(() => Effect.fail(new Error(`Session not found: ${args.session}`))),
      )
      if (args.fork) {
        // Create a forked session
        const forked = yield* controller.create({
          projectID: "default",
          title: existing.title,
          agent: args.agent,
          model: resolveModel(args.model),
          location: { directory },
        })
        sessionID = String(forked.id)
      } else {
        sessionID = String(existing.id)
      }
    } else if (args.continue) {
      // Find and continue the most recent session
      const sessions = yield* controller.list("default").pipe(
        Effect.catch(() => Effect.succeed([] as any[])),
      )
      const latest = sessions.sort((a: any, b: any) => {
        const aMs = typeof a.time.updated === "number" ? a.time.updated : Number(a.time.updated.epochMillis ?? a.time.updated)
        const bMs = typeof b.time.updated === "number" ? b.time.updated : Number(b.time.updated.epochMillis ?? b.time.updated)
        return bMs - aMs
      })[0]
      if (latest && args.fork) {
        const forked = yield* controller.create({
          projectID: "default",
          title: latest.title,
          agent: args.agent,
          model: resolveModel(args.model),
          location: { directory },
        })
        sessionID = String(forked.id)
      } else if (latest) {
        sessionID = String(latest.id)
      } else {
        // No existing session — create one
        const created = yield* controller.create({
          projectID: "default",
          title: args.title,
          agent: args.agent,
          model: resolveModel(args.model),
          location: { directory },
        })
        sessionID = String(created.id)
      }
    } else {
      // Create a fresh session
      const titleValue =
        args.title !== undefined && args.title !== ""
          ? args.title
          : rawMessage.slice(0, 50) + (rawMessage.length > 50 ? "..." : "")

      const created = yield* controller.create({
        projectID: "default",
        title: titleValue || undefined,
        agent: args.agent,
        model: resolveModel(args.model),
        location: { directory },
      })
      sessionID = String(created.id)
    }

    if (!emit("session", { sessionID })) {
      process.stderr.write(`${color.gray("Session:")} ${sessionID}${EOL}`)
    }

    // Submit the prompt
    yield* controller.prompt({
      sessionID: sessionID as any,
      text: message,
    })

    if (!useJsonFormat) {
      process.stdout.write(EOL)
    }
  })

  await Effect.runPromise(
    program.pipe(
      Effect.catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(color.red("Error: ") + msg + EOL)
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

export const RunCommand: CommandModule<object, RunArgs> = {
  command: "run [message..]",
  describe: "run neko with a message",

  builder: (yargs: Argv) =>
    yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("fork", {
        describe: "fork the session before continuing (requires --continue or --session)",
        type: "boolean",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "output format: default (formatted) or json (raw JSON events)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session",
      })
      .option("dir", {
        type: "string",
        describe: "directory to run in",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (reasoning effort, e.g., high, max, minimal)",
      })
      .option("thinking", {
        type: "boolean",
        describe: "show thinking blocks",
      })
      .option("auto", {
        type: "boolean",
        describe: "auto-approve permissions that are not explicitly denied (dangerous!)",
        default: false,
      })
      .option("yolo", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("dangerously-skip-permissions", {
        type: "boolean",
        hidden: true,
        default: false,
      }) as unknown as Argv<RunArgs>,

  handler: (args) => runHandler(args),
}
