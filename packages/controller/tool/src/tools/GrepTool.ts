/**
 * GrepTool — content search with regex across files.
 *
 * Ported from @lotus-code/core tool/grep.ts.
 * Logic kept identical.
 */
export * as GrepTool from "./GrepTool"

import fs from "fs"
import path from "path"
import { Effect, Schema } from "effect"
import { ToolFailure, make as makeTool, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "grep"

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const Input = Schema.Struct({
  pattern: Schema.String.annotate({
    description: "Regex pattern to search for in file contents",
  }),
  path: Schema.String.pipe(Schema.optional).annotate({
    description: "Relative directory to search. Defaults to the current working directory.",
  }),
  include: Schema.String.pipe(Schema.optional).annotate({
    description: 'File glob to include in the search (for example, "*.js" or "*.{ts,tsx}")',
  }),
  limit: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum matches to return",
  }),
})

export const Output = Schema.Array(
  Schema.Struct({
    entry: Schema.Struct({
      path: Schema.String,
      type: Schema.Literals(["file", "directory"]),
    }),
    line: Schema.Number,
    text: Schema.String,
  }),
)
type ModelOutput = typeof Output.Encoded

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const toModelOutput = (output: ModelOutput) => {
  const lines = output.length === 0 ? ["No files found"] : [`Found ${output.length} matches`]
  let current = ""
  for (const match of output) {
    if (current !== match.entry.path) {
      if (current) lines.push("")
      current = match.entry.path
      lines.push(`${match.entry.path}:`)
    }
    lines.push(`  Line ${match.line}: ${match.text}`)
  }
  return lines.join("\n")
}

/** Convert a simple glob include pattern to a RegExp (e.g. "*.ts" or "*.{ts,tsx}") */
function includeToRegex(include: string): RegExp {
  // Expand braces: *.{ts,tsx} → (*.ts|*.tsx)
  let expanded = include
  const braceMatch = include.match(/^(.*)\{([^}]+)\}(.*)$/)
  if (braceMatch) {
    const [, prefix, choices, suffix] = braceMatch
    expanded = (choices ?? "")
      .split(",")
      .map((c) => `${prefix}${c}${suffix}`)
      .join("|")
  }

  const parts = expanded.split("|").map((pat) => {
    return pat
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\{/g, "{")
      .replace(/\\\}/g, "}")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")
  })
  return new RegExp(`^(${parts.join("|")})$`)
}

type GrepMatch = {
  entry: { path: string; type: "file" | "directory" }
  line: number
  text: string
}

function grepFile(filePath: string, relPath: string, regex: RegExp, matches: GrepMatch[], limit: number): void {
  if (matches.length >= limit) return
  let content: string
  try {
    content = fs.readFileSync(filePath, "utf8")
  } catch {
    return
  }
  const lines = content.split("\n")
  for (let i = 0; i < lines.length && matches.length < limit; i++) {
    if (regex.test(lines[i]!)) {
      matches.push({ entry: { path: relPath, type: "file" }, line: i + 1, text: lines[i]! })
    }
  }
}

function walkGrep(
  dir: string,
  rootDir: string,
  fileRegex: RegExp | null,
  searchRegex: RegExp,
  limit: number,
  matches: GrepMatch[],
): void {
  if (matches.length >= limit) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (matches.length >= limit) break
    const absolute = path.join(dir, entry.name)
    const rel = path.relative(rootDir, absolute)
    if (entry.isDirectory()) {
      walkGrep(absolute, rootDir, fileRegex, searchRegex, limit, matches)
    } else if (entry.isFile()) {
      if (fileRegex && !fileRegex.test(entry.name)) continue
      grepFile(absolute, rel, searchRegex, matches, limit)
    }
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const tool: AnyTool = makeTool({
  description:
    "Search file contents by regular expression within the current working directory. Use a path to narrow the search, include to filter files by glob, and limit to bound the match count. Returns file paths, line numbers, and bounded line previews.",
  input: Input,
  output: Output,
  toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
  execute: (input, _context) =>
    Effect.gen(function* () {
      const limit = input.limit ?? Number.MAX_SAFE_INTEGER
      const searchRegex = yield* Effect.try({
        try: () => new RegExp(input.pattern),
        catch: () => new Error(`Invalid regex: ${input.pattern}`),
      })
      const fileRegex = input.include ? includeToRegex(input.include) : null
      const target = path.resolve(input.path ?? ".")
      const matches: GrepMatch[] = []

      yield* Effect.try({
        try: () => {
          const stat = fs.statSync(target)
          if (stat.isFile()) {
            grepFile(target, input.path ?? path.basename(target), searchRegex, matches, limit)
          } else {
            walkGrep(target, target, fileRegex, searchRegex, limit, matches)
          }
        },
        catch: (e) => new Error(String(e)),
      })

      return matches
    }).pipe(
      Effect.mapError(() => new ToolFailure({ message: `Unable to grep for ${input.pattern}` })),
    ),
})
