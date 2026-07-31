/**
 * ApplyUnifiedDiffTool — apply a standard unified diff (--unified format).
 *
 * This tool applies a unified diff (as produced by `diff -u` / `git diff`)
 * to existing files. Unlike ApplyPatchTool which uses the custom apply_patch
 * format, this works with standard unified-diff output.
 */
export * as ApplyUnifiedDiffTool from "./ApplyUnifiedDiffTool"

import fs from "fs"
import path from "path"
import { createTwoFilesPatch, diffLines } from "diff"
import { Effect, Schema } from "effect"
import { ToolFailure, make as makeTool, withPermission, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "apply_unified_diff"

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const Input = Schema.Struct({
  diff: Schema.String.annotate({
    description:
      "Standard unified diff text (as produced by `diff -u` or `git diff`). Must include --- and +++ header lines.",
  }),
})

export const Output = Schema.Struct({
  applied: Schema.Array(
    Schema.Struct({
      file: Schema.String,
      status: Schema.Literals(["added", "modified", "deleted"]),
      additions: Schema.Number,
      deletions: Schema.Number,
    }),
  ),
})
export type Output = typeof Output.Type

// ---------------------------------------------------------------------------
// Unified diff parser
// ---------------------------------------------------------------------------

type FilePatch = {
  fromFile: string
  toFile: string
  hunks: Array<{
    fromStart: number
    fromCount: number
    toStart: number
    toCount: number
    lines: string[]
  }>
}

function parseUnifiedDiff(text: string): FilePatch[] {
  const patches: FilePatch[] = []
  const lines = text.split("\n")
  let i = 0

  while (i < lines.length) {
    if (!lines[i]!.startsWith("---")) { i++; continue }
    const fromLine = lines[i]!
    i++
    if (!lines[i]?.startsWith("+++")) continue
    const toLine = lines[i]!
    i++

    const fromFile = fromLine.slice(4).split("\t")[0]!.trim().replace(/^a\//, "")
    const toFile = toLine.slice(4).split("\t")[0]!.trim().replace(/^b\//, "")

    const hunks: FilePatch["hunks"] = []
    while (i < lines.length && lines[i]!.startsWith("@@")) {
      const header = lines[i]!
      i++
      const match = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (!match) continue
      const fromStart = Number.parseInt(match[1]!, 10)
      const fromCount = match[2] !== undefined ? Number.parseInt(match[2], 10) : 1
      const toStart = Number.parseInt(match[3]!, 10)
      const toCount = match[4] !== undefined ? Number.parseInt(match[4], 10) : 1
      const hunkLines: string[] = []
      while (i < lines.length && !lines[i]!.startsWith("@@") && !lines[i]!.startsWith("---")) {
        hunkLines.push(lines[i]!)
        i++
      }
      hunks.push({ fromStart, fromCount, toStart, toCount, lines: hunkLines })
    }
    patches.push({ fromFile, toFile, hunks })
  }

  return patches
}

function applyPatch(original: string, patch: FilePatch): string {
  const lines = original.split("\n")
  const result: string[] = []
  let pos = 0 // 1-based current line in original

  for (const hunk of patch.hunks) {
    // Copy unchanged lines before this hunk
    while (pos < hunk.fromStart) {
      result.push(lines[pos - 1] ?? "")
      pos++
    }
    // Apply hunk
    let contextPos = hunk.fromStart
    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        result.push(line.slice(1))
      } else if (line.startsWith("-")) {
        contextPos++
        pos++
      } else {
        // Context line
        result.push(lines[pos - 1] ?? "")
        pos++
        contextPos++
      }
    }
  }
  // Copy remaining lines
  while (pos <= lines.length) {
    result.push(lines[pos - 1] ?? "")
    pos++
  }
  return result.join("\n")
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const toModelOutput = (output: Output) =>
  [
    "Applied unified diff:",
    ...output.applied.map(
      (f) => `${f.status === "added" ? "A" : f.status === "deleted" ? "D" : "M"} ${f.file} (+${f.additions}/-${f.deletions})`,
    ),
  ].join("\n")

export const tool: AnyTool = withPermission(
  makeTool({
    description:
      "Apply a standard unified diff (as produced by `diff -u` or `git diff`) to existing files in the current working directory. Hunks apply sequentially per file; if a hunk fails to apply, earlier hunks for that file remain applied.",
    input: Input,
    output: Output,
    toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
    execute: (input, _context) =>
      Effect.gen(function* () {
        if (!input.diff.trim())
          return yield* Effect.fail(new ToolFailure({ message: "diff text is required" }))

        const patches = yield* Effect.try({
          try: () => parseUnifiedDiff(input.diff),
          catch: (e) => new ToolFailure({ message: `Failed to parse unified diff: ${String(e)}` }),
        })

        if (patches.length === 0)
          return yield* Effect.fail(new ToolFailure({ message: "No file patches found in diff" }))

        const applied: Array<{ file: string; status: "added" | "modified" | "deleted"; additions: number; deletions: number }> = []

        for (const patch of patches) {
          const target = path.resolve(patch.toFile)
          const isNew = patch.fromFile === "/dev/null" || patch.fromFile === "dev/null"
          const isDeleted = patch.toFile === "/dev/null" || patch.toFile === "dev/null"

          yield* Effect.gen(function* () {
            if (isNew) {
              const content = patch.hunks
                .flatMap((h) => h.lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1)))
                .join("\n")
              yield* Effect.try({
                try: () => {
                  fs.mkdirSync(path.dirname(target), { recursive: true })
                  fs.writeFileSync(target, content, "utf8")
                },
                catch: (e) => new ToolFailure({ message: `Unable to create ${patch.toFile}: ${e}` }),
              })
              const counts = diffLines("", content).reduce(
                (r, item) => ({ additions: r.additions + (item.added ? (item.count ?? 0) : 0), deletions: r.deletions }),
                { additions: 0, deletions: 0 },
              )
              applied.push({ file: patch.toFile, status: "added", ...counts })
              return
            }

            const original = yield* Effect.try({
              try: () => fs.readFileSync(target, "utf8"),
              catch: (e) => new ToolFailure({ message: `Unable to read ${patch.fromFile}: ${e}` }),
            })

            if (isDeleted) {
              yield* Effect.try({
                try: () => fs.unlinkSync(target),
                catch: (e) => new ToolFailure({ message: `Unable to delete ${patch.fromFile}: ${e}` }),
              })
              const counts = diffLines(original as string, "").reduce(
                (r, item) => ({ additions: r.additions, deletions: r.deletions + (item.removed ? (item.count ?? 0) : 0) }),
                { additions: 0, deletions: 0 },
              )
              applied.push({ file: patch.fromFile, status: "deleted", ...counts })
              return
            }

            const updated = applyPatch(original as string, patch)
            yield* Effect.try({
              try: () => fs.writeFileSync(target, updated, "utf8"),
              catch: (e) => new ToolFailure({ message: `Unable to write ${patch.toFile}: ${e}` }),
            })
            const counts = diffLines(original as string, updated).reduce(
              (r, item) => ({
                additions: r.additions + (item.added ? (item.count ?? 0) : 0),
                deletions: r.deletions + (item.removed ? (item.count ?? 0) : 0),
              }),
              { additions: 0, deletions: 0 },
            )
            applied.push({ file: patch.toFile, status: "modified", ...counts })
          }).pipe(
            Effect.mapError((e) =>
              e instanceof ToolFailure
                ? e
                : new ToolFailure({ message: `Unable to apply patch to ${patch.toFile}` }),
            ),
          )
        }

        return { applied }
      }).pipe(
        Effect.mapError((e) =>
          e instanceof ToolFailure ? e : new ToolFailure({ message: "Unable to apply unified diff" }),
        ),
      ),
  }),
  "edit",
)
