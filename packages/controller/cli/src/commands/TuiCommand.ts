/**
 * TuiCommand — launches the gcloud-opencode TUI.
 *
 * Default command ($0) — runs when you invoke `gcloud-opencode` with no subcommand.
 * Starts the SolidJS + OpenTUI interface via @gco/view-tui.
 */

import type { CommandModule, Argv } from "yargs"
import path from "node:path"
import { Effect } from "effect"
import { run, type TuiInput } from "@gco/view-tui"
import { resolve as resolveTuiConfig } from "@gco/view-tui/config"
import { ProductionLayer } from "../bootstrap.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the working directory for the session.
 * Prefers $PWD over process.cwd() so symlinks are preserved.
 */
function resolveDirectory(project?: string): string {
  const root = process.env.PWD ?? process.cwd()
  if (!project) return path.resolve(root)
  return path.resolve(path.isAbsolute(project) ? project : path.join(root, project))
}

/**
 * Reads an initial prompt from --prompt flag or piped stdin (or both).
 */
async function resolveInitialPrompt(value?: string): Promise<string | undefined> {
  const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
  if (!value && !piped) return undefined
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

/** Build a default TuiConfig.Resolved with sensible defaults. */
function defaultTuiConfig(): TuiInput["config"] {
  return resolveTuiConfig(
    {},
    {
      terminalSuspend: process.platform !== "win32",
    },
  )
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
      .positional("project", {
        type: "string",
        describe: "path to start gcloud-opencode in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("prompt", {
        type: "string",
        describe: "initial prompt to send",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
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
      })
      .option("replay-limit", {
        type: "number",
        describe: "cap visible TUI replay to the newest N messages",
      })
      .option("demo", {
        type: "boolean",
        hidden: true,
      }) as unknown as Argv<TuiArgs>,

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

    const tuiInput: TuiInput = {
      url: "http://gcloud-opencode.internal",
      config: defaultTuiConfig(),
      directory: cwd,
      args: {
        agent: args.agent,
        model: args.model,
        prompt,
        auto: autoApprove,
      },
    }

    await Effect.runPromise(
      run(tuiInput).pipe(Effect.provide(ProductionLayer)),
    )

    process.exit(0)
  },
}
