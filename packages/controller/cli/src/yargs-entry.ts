/**
 * yargs-entry.ts — helpers for registering yargs commands cleanly.
 *
 * Re-exports CommandModule type from yargs and provides a typed helper
 * to keep command registrations consistent and readable.
 */

import type { CommandModule, Argv } from "yargs"

export type { CommandModule, Argv }

/**
 * Creates a typed yargs command module.
 * This is just a pass-through type helper that improves autocompletion
 * and ensures command modules conform to the CommandModule interface.
 *
 * @example
 * export const MyCommand = defineCommand<{ name: string }>({
 *   command: "my-command <name>",
 *   describe: "does something",
 *   builder: (yargs) => yargs.positional("name", { type: "string", demandOption: true }),
 *   handler: async (args) => { ... },
 * })
 */
export function defineCommand<T extends object>(module: CommandModule<object, T>): CommandModule<object, T> {
  return module
}
