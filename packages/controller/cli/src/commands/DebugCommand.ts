/**
 * DebugCommand — debugging and troubleshooting tools.
 *
 * Subcommands:
 *   config  — show effective config
 *   agent   — show agent registry
 *   startup — print startup timing
 *   info    — show version and environment info
 *   paths   — show global data/config/cache paths
 *   wait    — wait indefinitely (for debugging hangs)
 */

import type { CommandModule, Argv } from "yargs"
import { EOL } from "node:os"
import os from "node:os"
import path from "node:path"
import { Effect, Duration } from "effect"
import { color } from "@gco/view-cli"
import { AgentService } from "@gco/controller-agent"
import { dataRoot, dbPath, eventsRoot } from "@gco/model-local"
import { ProductionLayer } from "../bootstrap.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VERSION = process.env.NEKO_VERSION ?? "0.1.0"

function configPath(): string {
  return process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "neko")
    : path.join(os.homedir(), ".config", "neko")
}

function dataPath(): string {
  return process.env.XDG_DATA_HOME
    ? path.join(process.env.XDG_DATA_HOME, "neko")
    : path.join(os.homedir(), ".local", "share", "neko")
}

function cachePath(): string {
  return process.env.XDG_CACHE_HOME
    ? path.join(process.env.XDG_CACHE_HOME, "neko")
    : path.join(os.homedir(), ".cache", "neko")
}

function statePath(): string {
  return path.join(dataPath(), "state")
}

// ---------------------------------------------------------------------------
// config subcommand
// ---------------------------------------------------------------------------

const DebugConfigCommand: CommandModule<object, object> = {
  command: "config",
  describe: "show effective storage configuration",

  handler: async () => {
    process.stdout.write(
      JSON.stringify(
        {
          dataRoot: dataRoot(),
          dbPath: dbPath(),
          eventsRoot: eventsRoot(),
        },
        null,
        2,
      ) + EOL,
    )
  },
}

// ---------------------------------------------------------------------------
// agent subcommand
// ---------------------------------------------------------------------------

const DebugAgentCommand: CommandModule<object, object> = {
  command: "agent",
  describe: "show agent registry",

  handler: async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const agentSvc = yield* AgentService
        const agents = yield* agentSvc.all()

        for (const agent of agents) {
          process.stdout.write(`${agent.id} (${agent.mode ?? "all"})` + EOL)
          process.stdout.write(
            "  " + JSON.stringify({ hidden: agent.hidden, permissions: agent.permissions }, null, 2) + EOL,
          )
        }

        if (agents.length === 0) {
          process.stdout.write(color.gray("No agents registered.") + EOL)
        }
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
// startup subcommand
// ---------------------------------------------------------------------------

const DebugStartupCommand: CommandModule<object, object> = {
  command: "startup",
  describe: "print startup timing",

  handler: async () => {
    const start = Date.now()
    await Effect.runPromise(
      Effect.gen(function* () {
        // Force the ProductionLayer to fully construct so we time cold-start
        // costs (SQLite open + migrations, etc.).
        yield* AgentService
      }).pipe(
        Effect.catch(() => Effect.void),
        Effect.provide(ProductionLayer),
      ),
    )
    const elapsed = Date.now() - start
    process.stdout.write(`Startup time: ${elapsed}ms` + EOL)
  },
}

// ---------------------------------------------------------------------------
// info subcommand
// ---------------------------------------------------------------------------

const DebugInfoCommand: CommandModule<object, object> = {
  command: "info",
  describe: "show version and environment information",

  handler: async () => {
    const termProgram = process.env.TERM_PROGRAM
      ? `${process.env.TERM_PROGRAM}${process.env.TERM_PROGRAM_VERSION ? ` ${process.env.TERM_PROGRAM_VERSION}` : ""}`
      : undefined
    const terminal = [termProgram, process.env.TERM]
      .filter((x): x is string => Boolean(x))
      .join(" / ")

    process.stdout.write(`neko version: ${VERSION}` + EOL)
    process.stdout.write(`os: ${os.type()} ${os.release()} ${os.arch()}` + EOL)
    process.stdout.write(`node: ${process.version}` + EOL)
    process.stdout.write(`terminal: ${terminal || "unknown"}` + EOL)
    process.stdout.write(`project: ${process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? "(not set)"}` + EOL)
  },
}

// ---------------------------------------------------------------------------
// paths subcommand
// ---------------------------------------------------------------------------

const DebugPathsCommand: CommandModule<object, object> = {
  command: "paths",
  describe: "show global data/config/cache paths",

  handler: async () => {
    const paths: Record<string, string> = {
      config: configPath(),
      data: dataPath(),
      cache: cachePath(),
      state: statePath(),
    }

    for (const [key, value] of Object.entries(paths)) {
      process.stdout.write(key.padEnd(10) + value + EOL)
    }
  },
}

// ---------------------------------------------------------------------------
// wait subcommand
// ---------------------------------------------------------------------------

const DebugWaitCommand: CommandModule<object, object> = {
  command: "wait",
  describe: "wait indefinitely (for debugging)",

  handler: async () => {
    await Effect.runPromise(Effect.sleep(Duration.days(1)))
  },
}

// ---------------------------------------------------------------------------
// Top-level DebugCommand
// ---------------------------------------------------------------------------

export const DebugCommand: CommandModule<object, object> = {
  command: "debug",
  describe: "debugging and troubleshooting tools",

  builder: (yargs: Argv) =>
    yargs
      .command(DebugConfigCommand)
      .command(DebugAgentCommand)
      .command(DebugStartupCommand)
      .command(DebugInfoCommand)
      .command(DebugPathsCommand)
      .command(DebugWaitCommand)
      .demandCommand(1, "Specify a subcommand: config, agent, startup, info, paths, wait"),

  handler: async () => {},
}
