/**
 * ApplyPatchTool — apply a custom patch format containing add/update/delete ops.
 *
 * Ported from @lotus-code/core tool/apply-patch.ts.
 * Logic kept identical.
 */
export * as ApplyPatchTool from "./ApplyPatchTool"

import fs from "fs"
import path from "path"
import { createTwoFilesPatch, diffLines } from "diff"
import { Effect, Schema } from "effect"
import { ToolFailure, make as makeTool, withPermission, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "apply_patch"

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const Input = Schema.Struct({
  patchText: Schema.String.annotate({
    description: "The full patch text describing add, update, and delete operations",
  }),
})

export const Applied = Schema.Struct({
  type: Schema.Literals(["add", "update", "delete"]),
  resource: Schema.String,
  target: Schema.String,
})

export const Output = Schema.Struct({
  applied: Schema.Array(Applied),
  files: Schema.Array(
    Schema.Struct({
      file: Schema.String,
      patch: Schema.String,
      status: Schema.Literals(["added", "modified", "deleted"]),
      additions: Schema.Number,
      deletions: Schema.Number,
    }),
  ),
})
export type Output = typeof Output.Type

// ---------------------------------------------------------------------------
// Patch parser (minimal port of @lotus-code/core Patch)
// ---------------------------------------------------------------------------

type Chunk = { context: string[]; added: string[]; removed: string[] }

type Hunk =
  | { type: "add"; path: string; contents: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; movePath?: string; chunks: Chunk[] }

function parseHunks(text: string): Hunk[] {
  const hunks: Hunk[] = []
  const lines = text.split("\n")
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!.trimEnd()
    if (line.startsWith("*** Add file: ")) {
      const filePath = line.slice("*** Add file: ".length).trim()
      const contents: string[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith("***")) {
        contents.push(lines[i]!)
        i++
      }
      hunks.push({ type: "add", path: filePath, contents: contents.join("\n") })
    } else if (line.startsWith("*** Delete file: ")) {
      const filePath = line.slice("*** Delete file: ".length).trim()
      hunks.push({ type: "delete", path: filePath })
      i++
    } else if (line.startsWith("*** Update file: ") || line.startsWith("*** Move/Update file: ")) {
      const isMove = line.startsWith("*** Move/Update file: ")
      const rest = isMove
        ? line.slice("*** Move/Update file: ".length).trim()
        : line.slice("*** Update file: ".length).trim()
      const [filePath, movePath] = rest.split(" -> ")
      const chunks: Chunk[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith("*** ")) {
        if (lines[i]!.startsWith("@@ ")) {
          const chunk: Chunk = { context: [], added: [], removed: [] }
          i++
          while (i < lines.length && !lines[i]!.startsWith("@@") && !lines[i]!.startsWith("***")) {
            const l = lines[i]!
            if (l.startsWith("+") && !l.startsWith("+++")) chunk.added.push(l.slice(1))
            else if (l.startsWith("-") && !l.startsWith("---")) chunk.removed.push(l.slice(1))
            else chunk.context.push(l.startsWith(" ") ? l.slice(1) : l)
            i++
          }
          chunks.push(chunk)
        } else {
          i++
        }
      }
      hunks.push({
        type: "update",
        path: filePath!.trim(),
        ...(movePath ? { movePath: movePath.trim() } : {}),
        chunks,
      })
    } else {
      i++
    }
  }

  return hunks
}

function deriveUpdate(originalContent: string, chunks: Chunk[]): string {
  let result = originalContent
  for (const chunk of chunks) {
    // Apply each chunk as a search-replace using context + removed → context + added
    const search = [...chunk.removed].join("\n")
    const replace = [...chunk.added].join("\n")
    if (search && result.includes(search)) {
      result = result.replace(search, replace)
    } else if (chunk.removed.length === 0 && chunk.added.length > 0 && chunk.context.length > 0) {
      // Pure addition: insert after last context line
      const anchor = chunk.context[chunk.context.length - 1]!
      const idx = result.lastIndexOf(anchor)
      if (idx !== -1) {
        const insertAt = idx + anchor.length
        result = result.slice(0, insertAt) + "\n" + chunk.added.join("\n") + result.slice(insertAt)
      }
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function patchFileDiff(
  resource: string,
  before: string,
  after: string,
  status: "added" | "modified" | "deleted",
) {
  const counts = diffLines(before, after).reduce(
    (r, item) => ({
      additions: r.additions + (item.added ? (item.count ?? 0) : 0),
      deletions: r.deletions + (item.removed ? (item.count ?? 0) : 0),
    }),
    { additions: 0, deletions: 0 },
  )
  return {
    file: resource,
    patch: createTwoFilesPatch(resource, resource, before, after),
    status,
    ...counts,
  }
}

export const toModelOutput = (output: Output) =>
  [
    "Applied patch sequentially:",
    ...output.applied.map(
      (item) => `${item.type === "add" ? "A" : item.type === "delete" ? "D" : "M"} ${item.resource}`,
    ),
  ].join("\n")

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const tool: AnyTool = withPermission(
  makeTool({
    description:
      "Apply one patch containing add, update, and delete file operations. All targets are resolved and approved before target contents are read. Operations apply sequentially; if a later operation fails, earlier operations remain applied and the failure reports them explicitly. Moves and atomic rollback are not supported yet.",
    input: Input,
    output: Output,
    toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
    execute: (input, _context) => {
      const applied: Array<typeof Applied.Type> = []
      const fail = (p: string) => {
        const prefix =
          applied.length === 0
            ? `Unable to apply patch at ${p}`
            : `Patch partially applied before failing at ${p}. Applied: ${applied.map((item) => item.resource).join(", ")}`
        return new ToolFailure({ message: prefix })
      }

      return Effect.gen(function* () {
        if (!input.patchText.trim()) return yield* Effect.fail(new ToolFailure({ message: "patchText is required" }))
        const hunks = yield* Effect.try({
          try: () => parseHunks(input.patchText),
          catch: (cause) => new ToolFailure({ message: `apply_patch verification failed: ${String(cause)}` }),
        })
        if (hunks.length === 0) return yield* Effect.fail(new ToolFailure({ message: "patch rejected: empty patch" }))
        const move = hunks.find((h) => h.type === "update" && (h as any).movePath !== undefined)
        if (move) return yield* Effect.fail(new ToolFailure({ message: "apply_patch moves are not supported yet" }))

        const files: Array<{ file: string; patch: string; status: "added" | "modified" | "deleted"; additions: number; deletions: number }> = []

        for (const hunk of hunks) {
          const target = path.resolve(hunk.path)
          yield* Effect.gen(function* () {
            if (hunk.type === "add") {
              const content = hunk.contents.endsWith("\n") || hunk.contents === "" ? hunk.contents : `${hunk.contents}\n`
              yield* Effect.try({
                try: () => {
                  fs.mkdirSync(path.dirname(target), { recursive: true })
                  fs.writeFileSync(target, content, "utf8")
                },
                catch: () => fail(hunk.path),
              })
              applied.push({ type: "add", resource: hunk.path, target })
              files.push(patchFileDiff(hunk.path, "", content, "added"))
              return
            }

            if (hunk.type === "delete") {
              const before = yield* Effect.try({
                try: () => fs.readFileSync(target, "utf8"),
                catch: () => fail(hunk.path),
              })
              yield* Effect.try({
                try: () => fs.unlinkSync(target),
                catch: () => fail(hunk.path),
              })
              applied.push({ type: "delete", resource: hunk.path, target })
              files.push(patchFileDiff(hunk.path, before as string, "", "deleted"))
              return
            }

            // update
            const original = yield* Effect.try({
              try: () => fs.readFileSync(target, "utf8"),
              catch: () => fail(hunk.path),
            })
            const updated = deriveUpdate(original as string, hunk.chunks)
            yield* Effect.try({
              try: () => fs.writeFileSync(target, updated, "utf8"),
              catch: () => fail(hunk.path),
            })
            applied.push({ type: "update", resource: hunk.path, target })
            files.push(patchFileDiff(hunk.path, original as string, updated, "modified"))
          }).pipe(Effect.mapError((e) => (e instanceof ToolFailure ? e : fail(hunk.path))))
        }

        return { applied, files }
      }).pipe(Effect.mapError((error) => (error instanceof ToolFailure ? error : fail("patch"))))
    },
  }),
  "edit",
)
