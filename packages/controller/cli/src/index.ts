#!/usr/bin/env bun
/**
 * neko CLI entry point.
 *
 * Wires all commands together via yargs, sets the script name, and provides
 * consistent help/version flags.
 */

// Load provider API keys from neko.json into env vars before anything else
// runs. The ModelResolver reads these when picking an LLM client.
await (async () => {
  try {
    const file = Bun.file("neko.json")
    if (!(await file.exists())) return
    const cfg = await file.json()
    if (cfg?.provider?.deepseek?.apiKey && !process.env.DEEPSEEK_API_KEY)
      process.env.DEEPSEEK_API_KEY = cfg.provider.deepseek.apiKey
    if (cfg?.provider?.anthropic?.apiKey && !process.env.ANTHROPIC_API_KEY)
      process.env.ANTHROPIC_API_KEY = cfg.provider.anthropic.apiKey
    if (cfg?.provider?.openai?.apiKey && !process.env.OPENAI_API_KEY)
      process.env.OPENAI_API_KEY = cfg.provider.openai.apiKey
    if (cfg?.server?.port && !process.env.NEKO_SERVER_PORT)
      process.env.NEKO_SERVER_PORT = String(cfg.server.port)
  } catch {
    // Malformed neko.json — ignore.
  }
})()

import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { EOL } from "node:os"

// Commands
import { TuiCommand } from "./commands/TuiCommand.js"
import { UninstallCommand } from "./commands/UninstallCommand.js"
import { UpgradeCommand } from "./commands/UpgradeCommand.js"

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
  // Maintenance
  .command(UninstallCommand)
  .command(UpgradeCommand)
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
