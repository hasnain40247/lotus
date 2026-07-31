/**
 * UninstallCommand — uninstall gcloud-opencode and remove related files.
 *
 * Options:
 *   --keep-config  keep configuration files
 *   --keep-data    keep session data
 *   --dry-run      show what would be removed without removing
 *   --force        skip confirmation prompts
 */

import type { CommandModule, Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { EOL } from "node:os"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { color } from "@gco/view-cli"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UninstallArgs = {
  keepConfig: boolean
  keepData: boolean
  dryRun: boolean
  force: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortenPath(p: string): string {
  const home = os.homedir()
  return p.startsWith(home) ? p.replace(home, "~") : p
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

async function dirSize(dir: string): Promise<number> {
  let total = 0
  const walk = async (current: string) => {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        const stat = await fs.stat(full).catch(() => null)
        if (stat) total += stat.size
      }
    }
  }
  await walk(dir)
  return total
}

function configDir(): string {
  return (
    process.env.XDG_CONFIG_HOME
      ? path.join(process.env.XDG_CONFIG_HOME, "gcloud-opencode")
      : path.join(os.homedir(), ".config", "gcloud-opencode")
  )
}

function dataDir(): string {
  return (
    process.env.XDG_DATA_HOME
      ? path.join(process.env.XDG_DATA_HOME, "gcloud-opencode")
      : path.join(os.homedir(), ".local", "share", "gcloud-opencode")
  )
}

function cacheDir(): string {
  return (
    process.env.XDG_CACHE_HOME
      ? path.join(process.env.XDG_CACHE_HOME, "gcloud-opencode")
      : path.join(os.homedir(), ".cache", "gcloud-opencode")
  )
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function uninstallHandler(args: UninstallArgs): Promise<void> {
  process.stdout.write(EOL)
  prompts.intro("Uninstall gcloud-opencode")

  const targets: Array<{ path: string; label: string; keep: boolean }> = [
    { path: dataDir(), label: "Data", keep: args.keepData },
    { path: cacheDir(), label: "Cache", keep: false },
    { path: configDir(), label: "Config", keep: args.keepConfig },
  ]

  prompts.log.message("The following will be removed:")

  for (const target of targets) {
    const exists = await fs.access(target.path).then(() => true).catch(() => false)
    if (!exists) continue

    const size = await dirSize(target.path)
    const sizeStr = formatSize(size)
    const status = target.keep ? color.dim("(keeping)") : ""
    const prefix = target.keep ? "○" : "✓"
    prompts.log.info(
      `  ${prefix} ${target.label}: ${shortenPath(target.path)} ${color.gray(`(${sizeStr})`)}${status}`,
    )
  }

  if (!args.force && !args.dryRun) {
    const confirmed = await prompts.confirm({
      message: "Are you sure you want to uninstall?",
      initialValue: false,
    })
    if (!confirmed || prompts.isCancel(confirmed)) {
      prompts.outro("Cancelled")
      return
    }
  }

  if (args.dryRun) {
    prompts.log.warn("Dry run — no changes made")
    prompts.outro("Done")
    return
  }

  const spinner = prompts.spinner()
  for (const target of targets) {
    if (target.keep) {
      prompts.log.step(`Skipping ${target.label}`)
      continue
    }

    const exists = await fs.access(target.path).then(() => true).catch(() => false)
    if (!exists) continue

    spinner.start(`Removing ${target.label}...`)
    const err = await fs.rm(target.path, { recursive: true, force: true }).catch((e) => e)
    if (err instanceof Error) {
      spinner.stop(`Failed to remove ${target.label}`, 1)
    } else {
      spinner.stop(`Removed ${target.label}`)
    }
  }

  prompts.log.success("Thank you for using gcloud-opencode!")
  prompts.outro("Done")
}

// ---------------------------------------------------------------------------
// Command export
// ---------------------------------------------------------------------------

export const UninstallCommand: CommandModule<object, UninstallArgs> = {
  command: "uninstall",
  describe: "uninstall gcloud-opencode and remove all related files",

  builder: (yargs: Argv) =>
    yargs
      .option("keep-config", {
        alias: "c",
        type: "boolean",
        describe: "keep configuration files",
        default: false,
      })
      .option("keep-data", {
        alias: "d",
        type: "boolean",
        describe: "keep session data",
        default: false,
      })
      .option("dry-run", {
        type: "boolean",
        describe: "show what would be removed without removing",
        default: false,
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "skip confirmation prompts",
        default: false,
      }) as unknown as Argv<UninstallArgs>,

  handler: (args) => uninstallHandler(args),
}
