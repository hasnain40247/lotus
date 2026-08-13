export * as SlashCommand from "./slash-command"

import { Schema } from "effect"
import { optional } from "./schema"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  aliases: Schema.Array(Schema.String).pipe(optional),
}).annotate({ identifier: "SlashCommand.Info" })

export const registry: readonly Info[] = [
  { name: "rename",     description: "Rename the current session" },
  { name: "compact",    description: "Summarize the session to shrink the context window", aliases: ["summarize"] },
  { name: "timeline",   description: "Jump to a message in the transcript" },
  { name: "undo",       description: "Revert the previous user message" },
  { name: "redo",       description: "Restore a previously reverted message" },
  { name: "timestamps", description: "Toggle message timestamps", aliases: ["toggle-timestamps"] },
  { name: "thinking",   description: "Cycle assistant thinking display", aliases: ["toggle-thinking"] },
  { name: "copy",       description: "Copy the full session transcript to clipboard" },
  { name: "editor",     description: "Open the prompt in your $EDITOR" },
  { name: "skills",     description: "Insert a skill (/<skill>) into the prompt" },
  { name: "diff",       description: "Open the diff viewer" },
  { name: "agent",      description: "Create a new agent" },
  { name: "mcp",        description: "Manage MCP servers" },
]
