export * as SlashCommand from "./slash-command"

import { Schema } from "effect"
import { optional } from "./schema"

export type Status = "active" | "todo"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  aliases: Schema.Array(Schema.String).pipe(optional),
  // `"active"` = a `runSlashCommand` handler exists. `"todo"` = registered
  // for discoverability but not yet wired up. Rendered as separate sections
  // in the /-palette.
  status: Schema.Literals(["active", "todo"]).pipe(optional),
}).annotate({ identifier: "SlashCommand.Info" })

export const registry: readonly Info[] = [
  { name: "rename",     description: "Rename the current session", status: "active" },
  { name: "compact",    description: "Summarize the session to shrink the context window", aliases: ["summarize"], status: "active" },
  { name: "timeline",   description: "Jump to a message in the transcript", status: "todo" },
  { name: "undo",       description: "Revert the previous user message", status: "active" },
  { name: "redo",       description: "Restore a previously reverted message", status: "active" },
  { name: "timestamps", description: "Toggle message timestamps", aliases: ["toggle-timestamps"], status: "todo" },
  { name: "thinking",   description: "Cycle assistant thinking display", aliases: ["toggle-thinking"], status: "todo" },
  { name: "copy",       description: "Copy the full session transcript to clipboard", status: "active" },
  { name: "editor",     description: "Open the prompt in your $EDITOR", status: "todo" },
  { name: "skills",     description: "Insert a skill (/<skill>) into the prompt", status: "todo" },
  { name: "diff",       description: "Open the diff viewer", status: "todo" },
  { name: "agent",      description: "Create a new agent", status: "active" },
  { name: "mcp",        description: "Manage MCP servers", status: "active" },
  { name: "theme",      description: "Switch between light and dark themes", status: "active" },
  { name: "models",     description: "Switch the active model", status: "active" },
  { name: "clear",      description: "Start a fresh session (clears context and history)", status: "active" },
]
