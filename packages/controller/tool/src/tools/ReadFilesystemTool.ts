/**
 * ReadFilesystemTool — file-system read helpers used by ReadTool.
 *
 * Ported from @lotus-code/core tool/read-filesystem.ts.
 * Logic kept identical.
 */
export * as ReadFilesystemTool from "./ReadFilesystemTool"

import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"
import { Context, Effect, Layer, Schema } from "effect"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_READ_LINES = 2_000
export const MAX_READ_BYTES = 50 * 1024
export const MAX_MEDIA_INGEST_BYTES = 20 * 1024 * 1024
const MAX_LINE_LENGTH = 2_000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class BinaryFileError extends Schema.TaggedErrorClass<BinaryFileError>()("ReadTool.BinaryFileError", {
  resource: Schema.String,
}) {
  override get message() {
    return `Cannot read binary file: ${this.resource}`
  }
}

export class MediaIngestLimitError extends Schema.TaggedErrorClass<MediaIngestLimitError>()(
  "ReadTool.MediaIngestLimitError",
  { resource: Schema.String, maximumBytes: Schema.Number },
) {
  override get message() {
    return `Media exceeds ${this.maximumBytes} byte ingestion limit: ${this.resource}`
  }
}

export class MalformedUtf8Error extends Schema.TaggedErrorClass<MalformedUtf8Error>()("ReadTool.MalformedUtf8Error", {
  resource: Schema.String,
}) {
  override get message() {
    return `File is not valid UTF-8: ${this.resource}`
  }
}

export class OffsetOutOfRangeError extends Schema.TaggedErrorClass<OffsetOutOfRangeError>()(
  "ReadTool.OffsetOutOfRangeError",
  { offset: Schema.Number },
) {
  override get message() {
    return `Offset ${this.offset} is out of range`
  }
}

export class PathKindError extends Schema.TaggedErrorClass<PathKindError>()("ReadTool.PathKindError", {
  resource: Schema.String,
  expected: Schema.Literals(["a file", "a file or directory"]),
}) {
  override get message() {
    return `Path is not ${this.expected}: ${this.resource}`
  }
}

// ---------------------------------------------------------------------------
// Schema shapes
// ---------------------------------------------------------------------------

export const PageInput = Schema.Struct({
  offset: PositiveInt.pipe(Schema.optional),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_READ_LINES)).pipe(Schema.optional),
})
export type PageInput = typeof PageInput.Type

export class TextPage extends Schema.Class<TextPage>("ReadTool.TextPage")({
  type: Schema.Literal("text-page"),
  content: Schema.String,
  mime: Schema.String,
  offset: PositiveInt,
  truncated: Schema.Boolean,
  next: PositiveInt.pipe(Schema.optional),
}) {}

export class ListPage extends Schema.Class<ListPage>("ReadTool.ListPage")({
  entries: Schema.Array(
    Schema.Struct({ path: Schema.String, type: Schema.Literals(["file", "directory"]) }),
  ),
  truncated: Schema.Boolean,
  next: PositiveInt.pipe(Schema.optional),
}) {}

// ---------------------------------------------------------------------------
// FileContent shape (matches @lotus-code/core FileSystem.Content)
// ---------------------------------------------------------------------------

export const TextContent = Schema.Struct({
  uri: Schema.String,
  name: Schema.String,
  content: Schema.String,
  encoding: Schema.Literal("utf8"),
  mime: Schema.String,
})

export const Base64Content = Schema.Struct({
  uri: Schema.String,
  name: Schema.String,
  content: Schema.String,
  encoding: Schema.Literal("base64"),
  mime: Schema.String,
})

export const FileContent = Schema.Union([TextContent, Base64Content])
export type FileContent = typeof FileContent.Type

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".class", ".jar", ".war",
  ".7z", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods",
  ".odp", ".bin", ".dat", ".obj", ".o", ".a", ".lib", ".wasm", ".pyc", ".pyo",
])

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((v, i) => bytes[i] === v)
}

function imageMime(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]))
    return "image/webp"
}

function isBinary(resource: string, bytes: Uint8Array): boolean {
  if (BINARY_EXTENSIONS.has(path.extname(resource).toLowerCase())) return true
  if (bytes.length === 0) return false
  let nonPrintable = 0
  for (const byte of bytes) {
    if (byte === 0) return true
    if (byte < 9 || (byte > 13 && byte < 32)) nonPrintable++
  }
  return nonPrintable / bytes.length > 0.3
}

function mimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    ".ts": "text/typescript", ".tsx": "text/typescript", ".js": "text/javascript",
    ".jsx": "text/javascript", ".json": "application/json", ".html": "text/html",
    ".css": "text/css", ".md": "text/markdown", ".py": "text/x-python",
    ".rs": "text/x-rust", ".go": "text/x-go", ".rb": "text/x-ruby",
    ".sh": "text/x-sh", ".bash": "text/x-sh", ".yaml": "text/yaml",
    ".yml": "text/yaml", ".xml": "application/xml", ".svg": "image/svg+xml",
    ".txt": "text/plain",
  }
  return map[ext] ?? "application/octet-stream"
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface Interface {
  readonly inspect: (filePath: string) => Effect.Effect<"file" | "directory", PathKindError | Error>
  readonly read: (
    filePath: string,
    resource: string,
    page?: PageInput,
  ) => Effect.Effect<FileContent | TextPage, BinaryFileError | MediaIngestLimitError | MalformedUtf8Error | OffsetOutOfRangeError | PathKindError | Error>
  readonly list: (filePath: string, page?: PageInput) => Effect.Effect<ListPage, Error>
}

// ---------------------------------------------------------------------------
// Context.Tag
// ---------------------------------------------------------------------------

export class Service extends Context.Service<Service, Interface>()("@gco/ReadFilesystemTool") {}

// ---------------------------------------------------------------------------
// Implementation functions
// ---------------------------------------------------------------------------

function statSync(p: string) {
  try {
    return fs.statSync(fs.realpathSync(p))
  } catch {
    return null
  }
}

export const inspect = (filePath: string): Effect.Effect<"file" | "directory", PathKindError | Error> =>
  Effect.try({
    try: () => {
      const real = fs.realpathSync(filePath)
      const stat = fs.statSync(real)
      if (stat.isFile()) return "file" as const
      if (stat.isDirectory()) return "directory" as const
      throw new PathKindError({ resource: filePath, expected: "a file or directory" })
    },
    catch: (e) => (e instanceof PathKindError ? e : new Error(String(e))),
  })

export const read = (
  filePath: string,
  resource: string,
  page: PageInput = {},
): Effect.Effect<FileContent | TextPage, BinaryFileError | MediaIngestLimitError | MalformedUtf8Error | OffsetOutOfRangeError | PathKindError | Error> =>
  Effect.gen(function* () {
    const real = yield* Effect.try({ try: () => fs.realpathSync(filePath), catch: (e) => new Error(String(e)) })
    const stat = yield* Effect.try({ try: () => fs.statSync(real), catch: (e) => new Error(String(e)) })
    if (!stat.isFile()) return yield* Effect.fail(new PathKindError({ resource, expected: "a file" }))

    const first = yield* Effect.try({
      try: () => {
        const fd = fs.openSync(real, "r")
        const buf = Buffer.allocUnsafe(Math.min(64 * 1024, stat.size || 4 * 1024))
        const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0)
        fs.closeSync(fd)
        return buf.subarray(0, bytesRead)
      },
      catch: (e) => new Error(String(e)),
    })

    const mime = imageMime(first)
    if (mime) {
      if (stat.size > MAX_MEDIA_INGEST_BYTES)
        return yield* Effect.fail(new MediaIngestLimitError({ resource, maximumBytes: MAX_MEDIA_INGEST_BYTES }))
      const content = yield* Effect.try({
        try: () => fs.readFileSync(real).toString("base64"),
        catch: (e) => new Error(String(e)),
      })
      return {
        uri: pathToFileURL(real).href,
        name: path.basename(real),
        content,
        encoding: "base64" as const,
        mime,
      }
    }

    if (startsWith(first, [0x25, 0x50, 0x44, 0x46]) || BINARY_EXTENSIONS.has(path.extname(resource).toLowerCase()))
      return yield* Effect.fail(new BinaryFileError({ resource }))

    const paged = stat.size > MAX_READ_BYTES || page.offset !== undefined || page.limit !== undefined

    if (!paged) {
      if (isBinary(resource, first)) return yield* Effect.fail(new BinaryFileError({ resource }))
      const decoder = new TextDecoder("utf-8", { fatal: true })
      const text = yield* Effect.try({
        try: () => decoder.decode(fs.readFileSync(real)),
        catch: (e) => e instanceof TypeError ? new MalformedUtf8Error({ resource }) : new Error(String(e)),
      })
      return {
        uri: pathToFileURL(real).href,
        name: path.basename(real),
        content: text,
        encoding: "utf8" as const,
        mime: mimeType(real),
      }
    }

    // Paged reading
    const offset = page.offset ?? 1
    const limit = Math.min(page.limit ?? MAX_READ_LINES, MAX_READ_LINES)
    const lines: string[] = []
    const decoder = new TextDecoder("utf-8", { fatal: true })
    let pending = ""
    let discard = false
    let line = 1
    let bytes = 0
    let next: number | undefined

    const append = (input: string): boolean => {
      if (line < offset) { line++; return true }
      if (lines.length >= limit || bytes >= MAX_READ_BYTES) { next = line; return false }
      const text = input.length > MAX_LINE_LENGTH ? input.slice(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : input
      const size = Buffer.byteLength(text, "utf-8") + (lines.length > 0 ? 1 : 0)
      if (bytes + size > MAX_READ_BYTES) { next = line; return false }
      lines.push(text)
      bytes += size
      line++
      return true
    }

    const consume = (input: string): boolean => {
      let text = input
      while (true) {
        const index = text.indexOf("\n")
        if (index === -1) {
          if (!discard) {
            pending += text
            if (pending.length > MAX_LINE_LENGTH) { pending = pending.slice(0, MAX_LINE_LENGTH + 1); discard = true }
          }
          break
        }
        const current = pending + (discard ? "" : text.slice(0, index))
        pending = ""
        discard = false
        text = text.slice(index + 1)
        if (!append(current.endsWith("\r") ? current.slice(0, -1) : current)) return false
      }
      return true
    }

    // Read the file in chunks
    const rawContent = yield* Effect.try({
      try: () => fs.readFileSync(real),
      catch: (e) => new Error(String(e)),
    })

    const CHUNK = 64 * 1024
    let pos = 0
    let stopped = false
    while (pos < rawContent.length && !stopped) {
      const chunk = rawContent.subarray(pos, pos + CHUNK)
      pos += CHUNK
      if (isBinary(resource, chunk)) return yield* Effect.fail(new BinaryFileError({ resource }))
      let decoded: string
      try {
        decoded = decoder.decode(chunk, { stream: true })
      } catch {
        return yield* Effect.fail(new MalformedUtf8Error({ resource }))
      }
      if (!consume(decoded)) stopped = true
    }

    if (!stopped) {
      let tail: string
      try {
        tail = decoder.decode()
      } catch {
        return yield* Effect.fail(new MalformedUtf8Error({ resource }))
      }
      if (!discard) pending += tail
      if (pending) append(pending.endsWith("\r") ? pending.slice(0, -1) : pending)
    }

    if (lines.length === 0 && offset !== 1) return yield* Effect.fail(new OffsetOutOfRangeError({ offset }))
    return new TextPage({
      type: "text-page",
      content: lines.join("\n"),
      mime: mimeType(real),
      offset,
      truncated: next !== undefined,
      ...(next === undefined ? {} : { next }),
    })
  })

export const list = (filePath: string, page: PageInput = {}): Effect.Effect<ListPage, Error> =>
  Effect.gen(function* () {
    const real = yield* Effect.try({ try: () => fs.realpathSync(filePath), catch: (e) => new Error(String(e)) })
    const items = yield* Effect.try({ try: () => fs.readdirSync(real, { withFileTypes: true }), catch: (e) => new Error(String(e)) })
    const offset = page.offset ?? 1
    const limit = Math.min(page.limit ?? MAX_READ_LINES, MAX_READ_LINES)

    const entries = items.flatMap((item) => {
      try {
        const absolute = path.join(real, item.name)
        const target = fs.realpathSync(absolute)
        if (!target.startsWith(real + path.sep) && target !== real) return []
        const info = fs.statSync(target)
        const type = info.isDirectory() ? "directory" : info.isFile() ? "file" : undefined
        if (!type) return []
        return [{ path: item.name + (type === "directory" ? path.sep : ""), type } as { path: string; type: "directory" | "file" }]
      } catch {
        return []
      }
    })

    const visible = entries.sort((a, b) =>
      a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1,
    )
    const selected = visible.slice(offset - 1, offset - 1 + limit)
    const truncated = offset - 1 + selected.length < visible.length
    return new ListPage({ entries: selected, truncated, ...(truncated ? { next: offset + selected.length } : {}) })
  })

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const layer = Layer.succeed(
  Service,
  Service.of({
    inspect,
    read,
    list,
  }),
)
