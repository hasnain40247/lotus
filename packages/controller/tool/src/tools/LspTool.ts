/**
 * LspTool — LSP queries (diagnostics, go-to-definition, hover, etc.)
 *
 * Ported from @neko/neko tool/lsp.ts.
 * Logic kept identical — requires an ILspService context.
 */
export * as LspTool from "./LspTool"

import path from "path"
import { pathToFileURL } from "url"
import { Context, Effect, Layer, Schema } from "effect"
import { ToolFailure, make as makeTool, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "lsp"

export const DESCRIPTION = `Query the Language Server Protocol (LSP) for code intelligence operations.

Supported operations: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls.

Positions are 1-based (as shown in editors). Returns JSON-encoded LSP results or a plain-text "No results found" message.`

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const

export const Input = Schema.Struct({
  operation: Schema.Literals(operations).annotate({ description: "The LSP operation to perform" }),
  filePath: Schema.String.annotate({ description: "The absolute or relative path to the file" }),
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "The line number (1-based, as shown in editors)",
  }),
  character: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "The character offset (1-based, as shown in editors)",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "Search query for workspaceSymbol. Empty string requests all symbols.",
  }),
})

export type Operation = (typeof operations)[number]

export const Output = Schema.Struct({
  operation: Schema.String,
  filePath: Schema.String,
  result: Schema.Unknown,
  output: Schema.String,
})

// ---------------------------------------------------------------------------
// LSP service interface
// ---------------------------------------------------------------------------

export interface LspPosition {
  file: string
  line: number // 0-based
  character: number // 0-based
}

export interface ILspService {
  readonly hasClients: (file: string) => Effect.Effect<boolean>
  readonly touchFile: (file: string, type: "document") => Effect.Effect<void>
  readonly definition: (position: LspPosition) => Effect.Effect<unknown[]>
  readonly references: (position: LspPosition) => Effect.Effect<unknown[]>
  readonly hover: (position: LspPosition) => Effect.Effect<unknown[]>
  readonly documentSymbol: (uri: string) => Effect.Effect<unknown[]>
  readonly workspaceSymbol: (query: string) => Effect.Effect<unknown[]>
  readonly implementation: (position: LspPosition) => Effect.Effect<unknown[]>
  readonly prepareCallHierarchy: (position: LspPosition) => Effect.Effect<unknown[]>
  readonly incomingCalls: (position: LspPosition) => Effect.Effect<unknown[]>
  readonly outgoingCalls: (position: LspPosition) => Effect.Effect<unknown[]>
}

export class LspService extends Context.Service<LspService, ILspService>()("@gco/LspService") {}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export const makeLspTool = (lspService: ILspService, workingDirectory: string): AnyTool =>
  makeTool({
    description: DESCRIPTION,
    input: Input,
    output: Output,
    execute: (args, _context) =>
      Effect.gen(function* () {
        const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(workingDirectory, args.filePath)
        const uri = pathToFileURL(file).href
        const position: LspPosition = { file, line: args.line - 1, character: args.character - 1 }
        const relPath = path.relative(workingDirectory, file)
        const detail =
          args.operation === "workspaceSymbol"
            ? ""
            : args.operation === "documentSymbol"
              ? relPath
              : `${relPath}:${args.line}:${args.character}`
        const title = detail ? `${args.operation} ${detail}` : args.operation

        const available = yield* lspService.hasClients(file)
        if (!available)
          return yield* Effect.fail(new ToolFailure({ message: "No LSP server available for this file type." }))

        yield* lspService.touchFile(file, "document")

        const result: unknown[] = yield* (() => {
          switch (args.operation) {
            case "goToDefinition":
              return lspService.definition(position)
            case "findReferences":
              return lspService.references(position)
            case "hover":
              return lspService.hover(position)
            case "documentSymbol":
              return lspService.documentSymbol(uri)
            case "workspaceSymbol":
              return lspService.workspaceSymbol(args.query ?? "")
            case "goToImplementation":
              return lspService.implementation(position)
            case "prepareCallHierarchy":
              return lspService.prepareCallHierarchy(position)
            case "incomingCalls":
              return lspService.incomingCalls(position)
            case "outgoingCalls":
              return lspService.outgoingCalls(position)
          }
        })()

        return {
          operation: title,
          filePath: file,
          result,
          output: result.length === 0 ? `No results found for ${args.operation}` : JSON.stringify(result, null, 2),
        }
      }).pipe(Effect.mapError((e) => (e instanceof ToolFailure ? e : new ToolFailure({ message: `LSP error: ${e}` })))),
  })

/** Effect that builds the LspTool using the injected LspService. */
export const makeToolEffect: Effect.Effect<AnyTool, never, LspService> = Effect.gen(function* () {
  const ls = yield* LspService
  return makeLspTool(ls, process.cwd())
})
