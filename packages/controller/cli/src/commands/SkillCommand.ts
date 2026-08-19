/**
 * SkillCommand — scaffold and inspect skill files.
 *
 *   neko skill list             — list all resolvable skills
 *   neko skill create <name>    — scaffold a new skill (defaults to user-global)
 *                                  --project drops it under ./skills/ instead
 */

import type { CommandModule, Argv } from "yargs"
import { EOL } from "node:os"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { color } from "@gco/view-cli"
import {
  listAllSkills,
  projectSkillsDir,
  userSkillsDir,
} from "../skill-resolver.js"

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

const SkillListCommand: CommandModule<object, object> = {
  command: "list",
  aliases: ["ls"],
  describe: "list all available skills",

  handler: async () => {
    const skills = await listAllSkills().catch(() => [])
    if (skills.length === 0) {
      process.stdout.write(
        color.gray(
          `No skills yet. Create one with: neko skill create <name>${EOL}`,
        ),
      )
      return
    }
    for (const s of skills) {
      const badge = s.source === "project" ? color.blue("[project]") : color.gray("[user]   ")
      process.stdout.write(`${badge}  ${color.bold(s.name)}  ${color.gray("— " + s.description)}${EOL}`)
    }
  },
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

type CreateArgs = { name: string; project?: boolean; description?: string }

const TEMPLATE = (name: string, description: string) => `---
description: ${description}
---

# ${name}

Describe when to use this skill and the steps to follow.

1. Step one.
2. Step two.
3. Step three.
`

const SkillCreateCommand: CommandModule<object, CreateArgs> = {
  command: "create <name>",
  describe: "scaffold a new skill markdown file",

  builder: (yargs: Argv) =>
    yargs
      .positional("name", {
        describe: "skill name (used as filename and slash reference)",
        type: "string",
        demandOption: true,
      })
      .option("project", {
        describe: "create under ./skills/ (project-local) instead of the user-global config dir",
        type: "boolean",
        default: false,
      })
      .option("description", {
        alias: ["d"],
        describe: "short description used in the palette",
        type: "string",
      }) as unknown as Argv<CreateArgs>,

  handler: async (args) => {
    const safe = args.name.trim().replace(/[^a-zA-Z0-9._-]/g, "-")
    if (!safe) {
      process.stderr.write(color.red("Invalid skill name") + EOL)
      process.exitCode = 1
      return
    }

    const dir = args.project ? projectSkillsDir() : userSkillsDir()
    const filePath = path.join(dir, `${safe}.md`)

    try {
      await fs.mkdir(dir, { recursive: true })
    } catch (err) {
      process.stderr.write(color.red(`Failed to create ${dir}: ${err}`) + EOL)
      process.exitCode = 1
      return
    }

    const existing = await fs.stat(filePath).catch(() => undefined)
    if (existing) {
      process.stderr.write(color.yellow(`Skill already exists: ${filePath}`) + EOL)
      process.exitCode = 1
      return
    }

    const description = args.description?.trim() ?? "Describe what this skill does"
    await fs.writeFile(filePath, TEMPLATE(safe, description), "utf-8")

    process.stdout.write(color.green("Created: ") + filePath + EOL)
    process.stdout.write(
      color.gray(`Edit it, then invoke from a prompt with /${safe}`) + EOL,
    )
  },
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

export const SkillCommand: CommandModule<object, object> = {
  command: "skill",
  describe: "scaffold and inspect skill files",

  builder: (yargs: Argv) =>
    yargs
      .command(SkillListCommand)
      .command(SkillCreateCommand)
      .demandCommand(1, "Specify a subcommand: list, create"),

  handler: async () => {},
}
