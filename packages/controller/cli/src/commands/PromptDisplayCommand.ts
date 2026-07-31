/**
 * PromptDisplayCommand — render a prompt string for testing/debugging.
 *
 * This is a minimal command that prints a prompt using the TUI's
 * prompt display utility, useful for testing prompt rendering.
 */

import type { CommandModule, Argv } from "yargs"
import { EOL } from "node:os"
import { color } from "@gco/view-cli"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PromptDisplayArgs = {
  prompt?: string
  format?: string
}

// ---------------------------------------------------------------------------
// Command export
// ---------------------------------------------------------------------------

export const PromptDisplayCommand: CommandModule<object, PromptDisplayArgs> = {
  command: "prompt-display [prompt..]",
  describe: "render a prompt for testing",

  builder: (yargs: Argv) =>
    yargs
      .positional("prompt", {
        type: "string",
        describe: "prompt text to display",
        array: true,
      })
      .option("format", {
        type: "string",
        choices: ["plain", "json"],
        default: "plain",
        describe: "output format",
      }) as unknown as Argv<PromptDisplayArgs>,

  handler: (args) => {
    const parts = (args as any).prompt
    const text = Array.isArray(parts) ? parts.join(" ") : (parts ?? "")

    if (!text.trim()) {
      process.stderr.write(color.yellow("Warning: ") + "No prompt provided." + EOL)
      return
    }

    if (args.format === "json") {
      process.stdout.write(JSON.stringify({ prompt: text }) + EOL)
      return
    }

    // Plain text rendering
    process.stdout.write(
      color.bold("Prompt:") + EOL +
        color.gray("─".repeat(Math.min(process.stdout.columns ?? 80, 80))) + EOL +
        text + EOL +
        color.gray("─".repeat(Math.min(process.stdout.columns ?? 80, 80))) + EOL,
    )
  },
}
