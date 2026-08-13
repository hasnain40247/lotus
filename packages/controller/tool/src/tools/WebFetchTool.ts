/**
 * WebFetchTool — HTTP requests returning text, markdown, or HTML.
 *
 * Ported from @lotus-code/core tool/webfetch.ts.
 * Logic kept identical.
 */
export * as WebFetchTool from "./WebFetchTool"

import { Duration, Effect, Schema } from "effect"
import { ToolFailure, make as makeTool, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "webfetch"
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
export const DEFAULT_TIMEOUT_SECONDS = 30
export const MAX_TIMEOUT_SECONDS = 120

export const description = `Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default.

Use a more targeted tool when one is available. This tool is read-only. Large text results may be replaced with a preview while the complete output is retained in managed storage.`

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const Timeout = Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(MAX_TIMEOUT_SECONDS))

export const Input = Schema.Struct({
  url: Schema.String.annotate({ description: "The HTTP or HTTPS URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .annotate({ description: "The format to return the content in. Defaults to markdown." })
    .pipe(Schema.withDecodingDefault(Effect.succeed("markdown" as const))),
  timeout: Timeout.pipe(Schema.optional).annotate({
    description: `Optional timeout in seconds (maximum: ${MAX_TIMEOUT_SECONDS})`,
  }),
})

const Output = Schema.Struct({
  url: Schema.String,
  contentType: Schema.String,
  format: Schema.Literals(["text", "markdown", "html"]),
  output: Schema.String,
})

type Format = "text" | "markdown" | "html"

// ---------------------------------------------------------------------------
// Helpers (identical to original)
// ---------------------------------------------------------------------------

const browserUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"

const assertHttpUrl = (url: URL) => {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("URL must use http:// or https://")
}

const mimeFrom = (contentType: string) => contentType.split(";", 1)[0]?.trim().toLowerCase() ?? ""
const isImageAttachment = (mime: string) =>
  mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"
const isTextualMime = (mime: string) =>
  !mime ||
  mime.startsWith("text/") ||
  mime === "application/json" ||
  mime.endsWith("+json") ||
  mime === "application/xml" ||
  mime.endsWith("+xml") ||
  mime === "application/javascript" ||
  mime === "application/x-javascript"

export function extractTextFromHTML(html: string): string {
  // Simple text extraction without htmlparser2 dependency at runtime
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function convertHTMLToMarkdown(html: string): string {
  // Lazy-load TurndownService to avoid hard dependency failures in environments
  // that don't ship the browser-targeted packages.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const TurndownService = require("turndown") as typeof import("turndown")
    const turndown = new TurndownService({
      headingStyle: "atx",
      hr: "---",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
    })
    turndown.remove(["script", "style", "meta", "link"])
    return turndown.turndown(html)
  } catch {
    return extractTextFromHTML(html)
  }
}

const convert = (content: string, contentType: string, format: Format) => {
  if (!contentType.includes("text/html")) return content
  if (format === "markdown") return convertHTMLToMarkdown(content)
  if (format === "text") return extractTextFromHTML(content)
  return content
}

function acceptHeader(format: Format): string {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
  }
  return "*/*"
}

async function fetchWithTimeout(
  url: string,
  format: Format,
  userAgent: string,
  timeoutMs: number,
): Promise<{ body: Buffer; contentType: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": userAgent,
        Accept: acceptHeader(format),
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    const contentType = response.headers.get("content-type") || ""
    const mime = mimeFrom(contentType)
    if (isImageAttachment(mime)) throw new Error(`Unsupported fetched image content type: ${mime}`)
    if (!isTextualMime(mime)) throw new Error(`Unsupported fetched file content type: ${mime}`)

    const contentLength = response.headers.get("content-length")
    const declared = contentLength ? Number.parseInt(contentLength, 10) : undefined
    if (declared !== undefined && declared > MAX_RESPONSE_BYTES)
      throw new Error(`Response too large (exceeds ${MAX_RESPONSE_BYTES} byte limit)`)

    const chunks: Uint8Array[] = []
    let total = 0
    const reader = response.body?.getReader()
    if (!reader) throw new Error("No response body")
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw new Error(`Response too large (exceeds ${MAX_RESPONSE_BYTES} byte limit)`)
      chunks.push(value)
    }
    return { body: Buffer.concat(chunks), contentType }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const tool: AnyTool = makeTool({
  description,
  input: Input,
  output: Output,
  toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
  execute: (input, _context) =>
    Effect.gen(function* () {
      yield* Effect.try({
        try: () => assertHttpUrl(new URL(input.url)),
        catch: (error) => error,
      })

      const timeoutMs = (input.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000
      const { body, contentType } = yield* Effect.promise(() =>
        fetchWithTimeout(input.url, input.format, browserUserAgent, timeoutMs),
      )

      const content = new TextDecoder().decode(body)
      const output = yield* Effect.try({
        try: () => convert(content, contentType, input.format),
        catch: (error) => error,
      })

      return { url: input.url, contentType, format: input.format, output }
    }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to fetch ${input.url}` }))),
})
