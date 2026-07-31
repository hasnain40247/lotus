/**
 * WriteTool — file creation and overwrite.
 *
 * Ported from @opencode-ai/core tool/write.ts.
 * Logic kept identical.
 */
export * as WriteTool from "./WriteTool"

import fs from "fs"
import path from "path"
import { Effect, Schema } from "effect"
import { ToolFailure, make as makeTool, withPermission, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "write"

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const Input = Schema.Struct({
  path: Schema.String.annotate({
    description: "File path to write. Relative paths resolve from the current working directory.",
  }),
  content: Schema.String.annotate({ description: "Content to write to the file" }),
})

export const Output = Schema.Struct({
  operation: Schema.Literal("write"),
  target: Schema.String,
  resource: Schema.String,
  existed: Schema.Boolean,
})
export type Output = typeof Output.Type

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const toModelOutput = (output: Output) =>
  `${output.existed ? "Wrote" : "Created"} file successfully: ${output.resource}`

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const tool: AnyTool = withPermission(
  makeTool({
    description:
      "Write content to one file. Relative paths resolve from the current working directory. Creates the file if it does not exist, or overwrites it if it does.",
    input: Input,
    output: Output,
    toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
    execute: (input, _context) =>
      Effect.gen(function* () {
        const target = path.resolve(input.path)
        const existed = yield* Effect.try({ try: () => fs.existsSync(target), catch: () => false })
        yield* Effect.try({
          try: () => {
            fs.mkdirSync(path.dirname(target), { recursive: true })
            fs.writeFileSync(target, input.content, "utf8")
          },
          catch: (e) => new Error(String(e)),
        })
        return {
          operation: "write" as const,
          target,
          resource: input.path,
          existed: existed as boolean,
        }
      }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to write ${input.path}` }))),
  }),
  "edit",
)
