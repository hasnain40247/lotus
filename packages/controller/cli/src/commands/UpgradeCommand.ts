/**
 * UpgradeCommand — upgrade lotus-code to the latest or a specific version.
 *
 * Options:
 *   [target]   version to upgrade to (e.g., "0.2.0" or "v0.2.0")
 *   --method   installation method (npm, pnpm, bun, brew, curl, etc.)
 */

import type { CommandModule, Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { EOL } from "node:os"
import { spawnSync } from "node:child_process"
import { color } from "@gco/view-cli"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UpgradeArgs = {
  target?: string
  method?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type InstallMethod = "npm" | "pnpm" | "bun" | "yarn" | "brew" | "unknown"

function detectInstallMethod(): InstallMethod {
  const execPath = process.execPath.toLowerCase()
  if (execPath.includes("bun")) return "bun"
  if (execPath.includes("npm")) return "npm"
  if (execPath.includes("pnpm")) return "pnpm"
  if (execPath.includes("yarn")) return "yarn"
  if (execPath.includes("brew") || process.env.HOMEBREW_PREFIX) return "brew"
  return "unknown"
}

async function fetchLatestVersion(): Promise<string> {
  const response = await fetch(
    "https://registry.npmjs.org/@gco/controller-cli/latest",
  ).catch(() => undefined)
  if (!response?.ok) return "unknown"
  const json = (await response.json().catch(() => undefined)) as any
  return json?.version ?? "unknown"
}

function upgradeCommands(): Record<InstallMethod, string[]> {
  return {
    npm: ["npm", "install", "-g", "@gco/controller-cli"],
    pnpm: ["pnpm", "install", "-g", "@gco/controller-cli"],
    bun: ["bun", "install", "-g", "@gco/controller-cli"],
    yarn: ["yarn", "global", "add", "@gco/controller-cli"],
    brew: ["brew", "upgrade", "lotus-code"],
    unknown: [],
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function upgradeHandler(args: UpgradeArgs): Promise<void> {
  process.stdout.write(EOL)
  prompts.intro("Upgrade lotus-code")

  const detectedMethod = detectInstallMethod()
  const method = (args.method as InstallMethod | undefined) ?? detectedMethod

  if (method === "unknown") {
    prompts.log.error(
      `lotus-code is installed at ${process.execPath} and may be managed by a package manager.` + EOL +
        "Use --method to specify how to upgrade (npm, pnpm, bun, brew, etc.)",
    )
    prompts.outro("Done")
    return
  }

  prompts.log.info(`Installation method: ${method}`)

  const spinner = prompts.spinner()
  spinner.start("Fetching latest version...")
  const latest = args.target ? args.target.replace(/^v/, "") : await fetchLatestVersion()
  spinner.stop(`Latest: ${latest}`)

  if (latest === "unknown") {
    prompts.log.warn("Could not determine the latest version. Attempting upgrade anyway.")
  }

  const cmds = upgradeCommands()
  const upgradeCmd = cmds[method]

  if (!upgradeCmd || upgradeCmd.length === 0) {
    prompts.log.error(`No upgrade command available for method: ${method}`)
    prompts.outro("Done")
    return
  }

  if (latest !== "unknown") {
    prompts.log.info(`Upgrading to ${latest}...`)
  }

  const upgradeSpinner = prompts.spinner()
  upgradeSpinner.start(`Running: ${upgradeCmd.join(" ")}`)

  const result = spawnSync(upgradeCmd[0]!, upgradeCmd.slice(1), {
    stdio: "pipe",
    encoding: "utf8",
  })

  if (result.status !== 0) {
    upgradeSpinner.stop("Upgrade failed", 1)
    const errText = result.stderr?.trim()
    if (errText) prompts.log.error(errText)
    prompts.log.warn(`You may need to run manually: ${upgradeCmd.join(" ")}`)
  } else {
    upgradeSpinner.stop("Upgrade complete")
  }

  prompts.outro("Done")
}

// ---------------------------------------------------------------------------
// Command export
// ---------------------------------------------------------------------------

export const UpgradeCommand: CommandModule<object, UpgradeArgs> = {
  command: "upgrade [target]",
  describe: "upgrade lotus-code to the latest or a specific version",

  builder: (yargs: Argv) =>
    yargs
      .positional("target", {
        describe: "version to upgrade to (e.g., '0.2.0' or 'v0.2.0')",
        type: "string",
      })
      .option("method", {
        alias: "m",
        describe: "installation method to use",
        type: "string",
        choices: ["npm", "pnpm", "bun", "yarn", "brew"],
      }) as unknown as Argv<UpgradeArgs>,

  handler: (args) => upgradeHandler(args),
}
