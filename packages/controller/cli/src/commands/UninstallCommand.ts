/**
 * UninstallCommand — remove neko and all related files.
 *
 * Interactive: prompts for confirmation before removing anything.
 * Removes ~/.local/share/neko, ~/.cache/neko, ~/.config/neko, and the
 * neko binary itself.
 */

import type { CommandModule } from "yargs"
import * as prompts from "@clack/prompts"
import { EOL } from "node:os"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { color } from "@gco/view-cli"

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
      ? path.join(process.env.XDG_CONFIG_HOME, "neko")
      : path.join(os.homedir(), ".config", "neko")
  )
}

function dataDir(): string {
  return (
    process.env.XDG_DATA_HOME
      ? path.join(process.env.XDG_DATA_HOME, "neko")
      : path.join(os.homedir(), ".local", "share", "neko")
  )
}

function cacheDir(): string {
  return (
    process.env.XDG_CACHE_HOME
      ? path.join(process.env.XDG_CACHE_HOME, "neko")
      : path.join(os.homedir(), ".cache", "neko")
  )
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

type TargetKind = "dir" | "file"

async function pathSize(target: { path: string; kind: TargetKind }): Promise<number> {
  if (target.kind === "file") {
    const stat = await fs.stat(target.path).catch(() => null)
    return stat?.size ?? 0
  }
  return dirSize(target.path)
}

async function uninstallHandler(): Promise<void> {
  process.stdout.write(EOL)
  prompts.intro("Uninstall neko")

  const targets: Array<{ path: string; label: string; kind: TargetKind }> = [
    { path: dataDir(),         label: "Data",   kind: "dir"  },
    { path: cacheDir(),        label: "Cache",  kind: "dir"  },
    { path: configDir(),       label: "Config", kind: "dir"  },
    // Binary comes last so a mid-flight failure leaves the exe present for retry.
    { path: process.execPath,  label: "Binary", kind: "file" },
  ]

  prompts.log.message("The following will be removed:")

  for (const target of targets) {
    const exists = await fs.access(target.path).then(() => true).catch(() => false)
    if (!exists) continue

    const size = await pathSize(target)
    const sizeStr = formatSize(size)
    prompts.log.info(
      `  ✓ ${target.label}: ${shortenPath(target.path)} ${color.gray(`(${sizeStr})`)}`,
    )
  }

  const confirmed = await prompts.confirm({
    message: "Are you sure you want to uninstall?",
    initialValue: false,
  })
  if (!confirmed || prompts.isCancel(confirmed)) {
    prompts.outro("Cancelled")
    return
  }

  const spinner = prompts.spinner()
  for (const target of targets) {
    const exists = await fs.access(target.path).then(() => true).catch(() => false)
    if (!exists) continue

    spinner.start(`Removing ${target.label}...`)
    // macOS allows unlinking a running executable — the inode stays valid
    // until the process exits, so removing our own binary works here.
    const err = await fs.rm(target.path, { recursive: true, force: true }).catch((e) => e)
    if (err instanceof Error) {
      spinner.stop(`Failed to remove ${target.label}`, 1)
    } else {
      spinner.stop(`Removed ${target.label}`)
    }
  }

  prompts.log.success("Thank you for using neko!")
  prompts.outro("Done")
}

// ---------------------------------------------------------------------------
// Command export
// ---------------------------------------------------------------------------

export const UninstallCommand: CommandModule<object, object> = {
  command: "uninstall",
  describe: "uninstall neko and remove all related files",

  handler: () => uninstallHandler(),
}
