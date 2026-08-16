#!/usr/bin/env bun
/**
 * neko CLI entry point.
 *
 * Wires all commands together via yargs, sets the script name, and provides
 * consistent help/version flags.
 */

// Load neko.json GCP config into env vars before Effect reads them.
// Effect's Config.string() only reads process.env, so this must run first.
await (async () => {
  try {
    const file = Bun.file("neko.json")
    if (await file.exists()) {
      const cfg = await file.json()
      if (cfg?.gcp?.projectId && !process.env.NEKO_PROJECT_ID)
        process.env.NEKO_PROJECT_ID = cfg.gcp.projectId
      if (cfg?.gcp?.region && !process.env.NEKO_REGION)
        process.env.NEKO_REGION = cfg.gcp.region
      if (cfg?.provider?.deepseek?.apiKey && !process.env.DEEPSEEK_API_KEY)
        process.env.DEEPSEEK_API_KEY = cfg.provider.deepseek.apiKey
      if (cfg?.provider?.anthropic?.apiKey && !process.env.ANTHROPIC_API_KEY)
        process.env.ANTHROPIC_API_KEY = cfg.provider.anthropic.apiKey
      if (cfg?.server?.port && !process.env.NEKO_SERVER_PORT)
        process.env.NEKO_SERVER_PORT = String(cfg.server.port)
    }
  } catch {
    // Malformed neko.json — ignore, the config layer will produce a clear error.
  }
})()

import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { EOL } from "node:os"

// Commands
import { TuiCommand } from "./commands/TuiCommand.js"
import { RunCommand } from "./commands/RunCommand.js"
import { SessionCommand } from "./commands/SessionCommand.js"
import { ExportCommand } from "./commands/ExportCommand.js"
import { ImportCommand } from "./commands/ImportCommand.js"
import { AgentCommand } from "./commands/AgentCommand.js"
import { McpCommand } from "./commands/McpCommand.js"
import { ProvidersCommand } from "./commands/ProvidersCommand.js"
import { ModelsCommand } from "./commands/ModelsCommand.js"
import { DbCommand } from "./commands/DbCommand.js"
import { GenerateCommand } from "./commands/GenerateCommand.js"
import { UninstallCommand } from "./commands/UninstallCommand.js"
import { UpgradeCommand } from "./commands/UpgradeCommand.js"
import { DebugCommand } from "./commands/DebugCommand.js"
import { PromptDisplayCommand } from "./commands/PromptDisplayCommand.js"

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

const VERSION = process.env.NEKO_VERSION ?? "0.1.0"

// ---------------------------------------------------------------------------
// CLI setup
// ---------------------------------------------------------------------------

const args = hideBin(process.argv)

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("neko")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", VERSION)
  .alias("version", "v")
  .usage("")
  // Default command — launches TUI
  .command(TuiCommand)
  // Non-interactive run
  .command(RunCommand)
  // Session management
  .command(SessionCommand)
  // Export / import
  .command(ExportCommand)
  .command(ImportCommand)
  // Agent management
  .command(AgentCommand)
  // MCP server management
  .command(McpCommand)
  // Provider / credential management
  .command(ProvidersCommand)
  // Model listing
  .command(ModelsCommand)
  // Database / Firestore info
  .command(DbCommand)
  // Code generation
  .command(GenerateCommand)
  // Maintenance
  .command(UninstallCommand)
  .command(UpgradeCommand)
  // Developer tools
  .command(DebugCommand)
  .command(PromptDisplayCommand)
  .strict()
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp("log")
    }
    if (err) throw err
    process.exit(1)
  })

// ---------------------------------------------------------------------------
// Parse + error handling
// ---------------------------------------------------------------------------

try {
  await cli.parse()
} catch (e) {
  const message = e instanceof Error ? e.message : String(e)
  process.stderr.write(message + EOL)
  process.exitCode = 1
} finally {
  process.exit()
}
