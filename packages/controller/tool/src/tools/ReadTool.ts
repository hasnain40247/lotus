/**
 * ReadTool — file reading with image support (JPEG, PNG, GIF, WebP as base64).
 *
 * Ported from @lotus-code/core tool/read.ts.
 * Logic kept identical.
 */
export * as ReadTool from "./ReadTool"

import { Effect, Schema } from "effect"
import { ToolFailure, make as makeTool, type AnyTool } from "../Tool"
import {
  BinaryFileError,
  MediaIngestLimitError,
  PathKindError,
  TextContent,
  Base64Content,
  TextPage,
  ListPage,
  PageInput,
  inspect,
  read,
  list,
} from "./ReadFilesystemTool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "read"
const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])
export const MAX_READ_LINES = 2_000

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const Input = Schema.Struct({
  path: Schema.String.annotate({ description: "File or directory path to read" }),
  offset: PositiveInt.pipe(Schema.optional).annotate({
    description: "The 1-based directory entry or text line offset to start reading from",
  }),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_READ_LINES))
    .pipe(Schema.optional)
    .annotate({
      description: "The maximum number of directory entries or text lines to read",
    }),
})

const Output = Schema.Union([TextContent, Base64Content, TextPage, ListPage])

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const tool: AnyTool = makeTool({
  description:
    "Read a text file or supported image, page through a large UTF-8 text file by line offset, or list a directory page. Relative paths resolve from the current working directory.",
  input: Input,
  output: Output,
  toModelOutput: ({ input, output }) => {
    if (!("encoding" in output) || output.encoding !== "base64" || !SUPPORTED_IMAGE_MIMES.has(output.mime))
      return []
    return [
      { type: "text", text: "Image read successfully" },
      { type: "file", data: output.content, mime: output.mime, name: input.path },
    ]
  },
  execute: (input, _context) =>
    Effect.gen(function* () {
      const filePath = input.path
      const pageInput: PageInput = { offset: input.offset, limit: input.limit }
      const type = yield* inspect(filePath)
      if (type === "directory") return yield* list(filePath, pageInput)
      const content = yield* read(filePath, filePath, pageInput)
      if ("encoding" in content && content.encoding === "base64" && SUPPORTED_IMAGE_MIMES.has(content.mime)) {
        return content
      }
      if ("encoding" in content && content.encoding === "base64")
        return yield* Effect.fail(new BinaryFileError({ resource: filePath }))
      return content
    }).pipe(
      Effect.mapError((error) => {
        const message =
          error instanceof BinaryFileError ||
          error instanceof MediaIngestLimitError ||
          error instanceof PathKindError
            ? error.message
            : `Unable to read ${input.path}`
        return new ToolFailure({ message })
      }),
    ),
})
