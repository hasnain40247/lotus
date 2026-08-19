/**
 * DbCommand — inspect the on-disk data store.
 *
 * neko persists state locally under `$XDG_DATA_HOME/neko` (defaults to
 * `~/.local/share/neko`). This command prints the resolved paths so the
 * user can `sqlite3` / `ls` them directly.
 *
 * Subcommands:
 *   path — print local data paths
 */

import type { CommandModule, Argv } from "yargs"
import { EOL } from "node:os"
import { color } from "@gco/view-cli"
import { dataRoot, dbPath, eventsRoot } from "@gco/model-local"

const DbPathCommand: CommandModule<object, object> = {
  command: "path",
  describe: "print local storage paths",

  handler: async () => {
    process.stdout.write(`Data root:  ${color.bold(dataRoot())}` + EOL)
    process.stdout.write(`SQLite DB:  ${dbPath()}` + EOL)
    process.stdout.write(`Events:     ${eventsRoot()}/{sessionID}/{seq}.json` + EOL)
  },
}

export const DbCommand: CommandModule<object, object> = {
  command: "db",
  describe: "database tools",

  builder: (yargs: Argv) =>
    yargs
      .command(DbPathCommand)
      .demandCommand(1, "Specify a subcommand: path"),

  handler: async () => {},
}
