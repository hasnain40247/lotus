/**
 * EditTool — targeted exact string replacement in existing files.
 *
 * Ported from @opencode-ai/core tool/edit.ts.
 * Logic kept identical.
 */
export * as EditTool from "./EditTool"

import fs from "fs"
import path from "path"
import { createTwoFilesPatch, diffLines } from "diff"
import { Effect, Schema } from "effect"
import { ToolFailure, make as makeTool, withPermission, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "edit"

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const Input = Schema.Struct({
  path: Schema.String.annotate({
    description: "File path to edit. Relative paths resolve from the current working directory.",
  }),
  oldString: Schema.String.annotate({ description: "Exact text to replace" }),
  newString: Schema.String.annotate({ description: "Replacement text, which must differ from oldString" }),
  replaceAll: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Replace all exact occurrences of oldString (default false)",
  }),
})

export const Output = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      file: Schema.String,
      patch: Schema.String,
      status: Schema.Literals(["added", "modified", "deleted"]),
      additions: Schema.Number,
      deletions: Schema.Number,
    }),
  ),
  replacements: Schema.Number,
})
export type Output = typeof Output.Type

// ---------------------------------------------------------------------------
// Helpers (identical to original)
// ---------------------------------------------------------------------------

const normalizeLineEndings = (text: string) => text.replaceAll("\r\n", "\n")
const detectLineEnding = (text: string): "\n" | "\r\n" => (text.includes("\r\n") ? "\r\n" : "\n")
const convertToLineEnding = (text: string, ending: "\n" | "\r\n") =>
  ending === "\n" ? normalizeLineEndings(text) : normalizeLineEndings(text).replaceAll("\n", "\r\n")

const splitBom = (text: string) =>
  text.startsWith("﻿") ? { bom: true, text: text.slice(1) } : { bom: false, text }
const joinBom = (text: string, bom: boolean) => (bom ? `﻿${text}` : text)
const decodeUtf8 = (content: Uint8Array) => {
  const bom = content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
  return { bom, content, text: new TextDecoder().decode(bom ? content.slice(3) : content) }
}

const countOccurrences = (content: string, search: string) => {
  if (search === "") return content.length + 1
  let count = 0
  let offset = 0
  while ((offset = content.indexOf(search, offset)) !== -1) {
    count++
    offset += search.length
  }
  return count
}

const previewLines = (value: string, prefix: "+" | "-") => {
  const lines = normalizeLineEndings(value).split("\n")
  const shown = lines.slice(0, 6).map((line) => `${prefix}${line.length > 240 ? `${line.slice(0, 240)}...` : line}`)
  if (lines.length > shown.length) shown.push(`${prefix}...`)
  return shown
}

export const toModelOutput = (output: Output, oldString: string, newString: string) =>
  [
    `Edited file successfully: ${output.files[0]?.file}`,
    `Replacements: ${output.replacements}`,
    "```diff",
    ...previewLines(oldString, "-"),
    ...previewLines(newString, "+"),
    "```",
  ].join("\n")

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const tool: AnyTool = withPermission(
  makeTool({
    description:
      "Replace exact text in one file. Relative paths resolve from the current working directory.",
    input: Input,
    output: Output,
    toModelOutput: ({ input, output }) => [
      { type: "text", text: toModelOutput(output, input.oldString, input.newString) },
    ],
    execute: (input, _context) => {
      const unableToEdit = <A, E>(effect: Effect.Effect<A, E>) =>
        effect.pipe(
          Effect.mapError(
            (error) => new ToolFailure({ message: `Unable to edit ${input.path}` }),
          ),
        )

      return Effect.gen(function* () {
        if (input.oldString === input.newString) {
          return yield* Effect.fail(
            new ToolFailure({ message: "No changes to apply: oldString and newString are identical." }),
          )
        }
        if (input.oldString === "") {
          return yield* Effect.fail(
            new ToolFailure({ message: "oldString must not be empty. Use write to create or overwrite a file." }),
          )
        }

        const target = path.resolve(input.path)
        const rawContent = yield* unableToEdit(
          Effect.try({ try: () => fs.readFileSync(target), catch: (e) => new Error(String(e)) }),
        )
        const source = decodeUtf8(rawContent)
        const ending = detectLineEnding(source.text)
        const oldString = convertToLineEnding(input.oldString, ending)
        const newString = convertToLineEnding(input.newString, ending)
        const replacements = countOccurrences(source.text, oldString)

        if (replacements === 0) {
          return yield* Effect.fail(
            new ToolFailure({
              message:
                "Could not find oldString in the file. It must match exactly, including whitespace and indentation.",
            }),
          )
        }
        if (replacements > 1 && input.replaceAll !== true) {
          return yield* Effect.fail(
            new ToolFailure({
              message:
                "Found multiple exact matches for oldString. Provide more surrounding context or set replaceAll to true.",
            }),
          )
        }

        const replaced =
          input.replaceAll === true
            ? source.text.replaceAll(oldString, newString)
            : source.text.replace(oldString, newString)

        const counts = diffLines(source.text, replaced).reduce(
          (result, item) => ({
            additions: result.additions + (item.added ? (item.count ?? 0) : 0),
            deletions: result.deletions + (item.removed ? (item.count ?? 0) : 0),
          }),
          { additions: 0, deletions: 0 },
        )

        const next = splitBom(replaced)
        const finalContent = joinBom(next.text, source.bom || next.bom)

        yield* unableToEdit(
          Effect.try({ try: () => fs.writeFileSync(target, finalContent, "utf8"), catch: (e) => new Error(String(e)) }),
        )

        return {
          files: [
            {
              file: input.path,
              patch: createTwoFilesPatch(input.path, input.path, source.text, replaced),
              status: "modified" as const,
              ...counts,
            },
          ],
          replacements,
        } satisfies Output
      })
    },
  }),
  "edit",
)
