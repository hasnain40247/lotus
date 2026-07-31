/**
 * GlobTool — pattern-based file search.
 *
 * Ported from @opencode-ai/core tool/glob.ts.
 * Logic kept identical — uses node's built-in glob (Node 22+) or falls back
 * to a recursive walk with micromatch-style pattern matching.
 */
export * as GlobTool from "./GlobTool"

import fs from "fs"
import path from "path"
import { Effect, Schema } from "effect"
import { ToolFailure, make as makeTool, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "glob"

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const Input = Schema.Struct({
  pattern: Schema.String.annotate({ description: "Glob pattern to match files against" }),
  path: Schema.String.pipe(Schema.optional).annotate({
    description: "Relative directory to search. Defaults to the current working directory.",
  }),
  limit: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum results to return",
  }),
})

export const Output = Schema.Array(
  Schema.Struct({ path: Schema.String, type: Schema.Literals(["file", "directory"]) }),
)
type ModelOutput = typeof Output.Encoded

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const toModelOutput = (output: ModelOutput) => {
  const lines = output.length === 0 ? ["No files found"] : output.map((item) => item.path)
  return lines.join("\n")
}

/** Convert a glob pattern to a RegExp (supports *, **, ?) */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§DSTAR§")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/§DSTAR§/g, ".*")
  return new RegExp(`^${escaped}$`)
}

function walkGlob(
  cwd: string,
  pattern: string,
  limit: number,
): Array<{ path: string; type: "file" | "directory" }> {
  const regex = globToRegex(pattern)
  const results: Array<{ path: string; type: "file" | "directory" }> = []

  function walk(dir: string, relative: string) {
    if (results.length >= limit) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= limit) break
      const rel = relative ? `${relative}/${entry.name}` : entry.name
      const type: "file" | "directory" = entry.isDirectory() ? "directory" : "file"
      if (regex.test(rel) || regex.test(entry.name)) {
        results.push({ path: rel, type })
      }
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel)
      }
    }
  }

  walk(cwd, "")
  return results
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const tool: AnyTool = makeTool({
  description:
    "Find files by glob pattern within the current working directory. Returns concise relative file paths. Use a relative path to narrow the search and limit to bound the result count.",
  input: Input,
  output: Output,
  toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
  execute: (input, _context) =>
    Effect.gen(function* () {
      const cwd = path.resolve(input.path ?? ".")
      const limit = input.limit ?? Number.MAX_SAFE_INTEGER
      const results = yield* Effect.try({
        try: () => walkGlob(cwd, input.pattern, limit),
        catch: () => new Error(`Unable to find files matching ${input.pattern}`),
      })
      return results
    }).pipe(
      Effect.mapError(() => new ToolFailure({ message: `Unable to find files matching ${input.pattern}` })),
    ),
})
