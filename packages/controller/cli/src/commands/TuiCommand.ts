/**
 * TuiCommand — launches the gcloud-opencode TUI.
 *
 * Default command ($0) — runs when you invoke `gcloud-opencode` with no subcommand.
 * Starts the SolidJS + OpenTUI interface via @gco/view-tui.
 *
 * All services (SessionController, EventRepository, AgentController) are
 * yielded inside a single Effect.gen so their Firestore connections stay
 * alive for the full TUI session. The concrete method implementations are
 * extracted as Promise-returning functions and handed to the HTTP server.
 */

import type { CommandModule, Argv } from "yargs"
import path from "node:path"
import { Effect } from "effect"
import { run, type TuiInput } from "@gco/view-tui"
import { resolve as resolveTuiConfig } from "@gco/view-tui/config"
import { SessionController } from "@gco/controller-session"
import { EventRepository } from "@gco/model-domain"
import { ProductionLayer } from "../bootstrap.js"
import { startTuiServer, type TuiServerServices } from "../tui-server.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveDirectory(project?: string): string {
  const root = process.env.PWD ?? process.cwd()
  if (!project) return path.resolve(root)
  return path.resolve(path.isAbsolute(project) ? project : path.join(root, project))
}

async function resolveInitialPrompt(value?: string): Promise<string | undefined> {
  const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
  if (!value && !piped) return undefined
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

function defaultTuiConfig(): TuiInput["config"] {
  return resolveTuiConfig({}, { terminalSuspend: process.platform !== "win32" })
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

type TuiArgs = {
  project?: string
  model?: string
  prompt?: string
  agent?: string
  auto: boolean
  yolo: boolean
  "dangerously-skip-permissions": boolean
  "replay-limit"?: number
  demo?: boolean
}

export const TuiCommand: CommandModule<object, TuiArgs> = {
  command: "$0 [project]",
  describe: "start gcloud-opencode TUI",

  builder: (yargs: Argv) =>
    yargs
      .positional("project", { type: "string", describe: "path to start gcloud-opencode in" })
      .option("model", { type: "string", alias: ["m"], describe: "model to use (provider/model-id)" })
      .option("prompt", { type: "string", describe: "initial prompt to send" })
      .option("agent", { type: "string", describe: "agent to use" })
      .option("auto", {
        type: "boolean",
        describe: "auto-approve all permissions (dangerous!)",
        default: false,
      })
      .option("yolo", { type: "boolean", hidden: true, default: false })
      .option("dangerously-skip-permissions", { type: "boolean", hidden: true, default: false })
      .option("replay-limit", { type: "number", describe: "cap TUI replay to newest N messages" })
      .option("demo", { type: "boolean", hidden: true }) as unknown as Argv<TuiArgs>,

  handler: async (args) => {
    const directory = resolveDirectory(args.project)
    try {
      process.chdir(directory)
    } catch {
      process.stderr.write(`Failed to change directory to ${directory}\n`)
      process.exit(1)
    }

    const prompt = await resolveInitialPrompt(args.prompt)
    const autoApprove = args.auto || args.yolo || args["dangerously-skip-permissions"]
    const cwd = process.cwd()

    await Effect.runPromise(
      Effect.gen(function* () {
        // Yield the services we need — their Firestore connections stay
        // alive for the duration of this Effect scope.
        const sessionCtrl = yield* SessionController
        const eventRepo = yield* EventRepository

        // Wrap Effect methods as plain Promises for the HTTP server.
        const services: TuiServerServices = {
          createSession: (input) =>
            Effect.runPromise(sessionCtrl.create(input as any)),

          getSession: (id) =>
            Effect.runPromise(sessionCtrl.get(id as any)),

          listSessions: (projectID) =>
            Effect.runPromise(sessionCtrl.list(projectID)),

          prompt: (input) =>
            Effect.runPromise(
              sessionCtrl.prompt({
                sessionID: input.sessionID as any,
                text: input.text,
                files: input.files as any,
                id: input.id as any,
              }),
            ),

          loadEvents: (sessionID) =>
            Effect.runPromise(eventRepo.load(sessionID as any)),

          listAgents: () => Promise.resolve([]),
        }

        const server = startTuiServer(cwd, services)

        const tuiInput: TuiInput = {
          url: `http://localhost:${server.port}`,
          config: defaultTuiConfig(),
          directory: cwd,
          args: {
            agent: args.agent,
            model: args.model ?? "deepseek/deepseek-chat",
            prompt,
            auto: autoApprove,
          },
        }

        try {
          yield* run(tuiInput)
        } finally {
          server.stop(true)
        }
      }).pipe(Effect.provide(ProductionLayer)),
    )

    process.exit(0)
  },
}
