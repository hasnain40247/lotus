/**
 * Core tool definition types and runtime helpers.
 *
 * Ported from @opencode-ai/core tool/tool.ts — logic is kept identical.
 */
export * as Tool from "./Tool"

import { Effect, JsonSchema, Schema } from "effect"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ToolContext {
  readonly sessionID: string
  readonly agent: string
  readonly assistantMessageID: string
  readonly toolCallID: string
}

export type SchemaType<A> = Schema.Codec<A, any, never, never>

declare const TypeId: unique symbol

export interface Definition<Input extends SchemaType<any>, Output extends SchemaType<any>> {
  readonly [TypeId]: {
    readonly _Input: Input
    readonly _Output: Output
  }
}

export type AnyTool = Definition<any, any>

export class ToolFailure extends Schema.TaggedErrorClass<ToolFailure>()("ToolFailure", {
  message: Schema.String,
}) {}

export class RegistrationError extends Schema.TaggedErrorClass<RegistrationError>()("Tool.RegistrationError", {
  name: Schema.String,
  message: Schema.String,
}) {}

export type Content =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly data: string; readonly mime: string; readonly name?: string }

// ---------------------------------------------------------------------------
// ToolDefinition & ToolOutput shims
// (mirrors @opencode-ai/llm shapes without the real dependency)
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchema.JsonSchema
  readonly outputSchema: JsonSchema.JsonSchema
}

export type ToolResultValue =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "error"; readonly value: string }

export interface ToolOutput {
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string } | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }>
  readonly structured: unknown
}

export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly input: unknown
}

// ---------------------------------------------------------------------------
// Internal runtime
// ---------------------------------------------------------------------------

type Config<
  Input extends SchemaType<any>,
  Output extends SchemaType<any>,
  Structured extends SchemaType<any> = Output,
> = {
  readonly description: string
  readonly input: Input
  readonly output: Output
  readonly structured?: Structured
  readonly toStructuredOutput?: (args: {
    readonly input: Schema.Schema.Type<Input>
    readonly output: Output["Encoded"]
  }) => Schema.Schema.Type<Structured>
  readonly execute: (
    input: Schema.Schema.Type<Input>,
    context: ToolContext,
  ) => Effect.Effect<Schema.Schema.Type<Output>, ToolFailure>
  readonly toModelOutput?: (args: {
    readonly input: Schema.Schema.Type<Input>
    readonly output: Output["Encoded"]
  }) => ReadonlyArray<Content>
}

type Runtime = {
  readonly permission?: string
  readonly definition: (name: string) => ToolDefinition
  readonly settle: (call: ToolCall, context: ToolContext) => Effect.Effect<ToolOutput, ToolFailure>
}

const runtimes = new WeakMap<AnyTool, Runtime>()

export function make<
  Input extends SchemaType<any>,
  Output extends SchemaType<any>,
  Structured extends SchemaType<any> = Output,
>(config: Config<Input, Output, Structured>): Definition<Input, Structured> {
  const tool = Object.freeze({}) as Definition<Input, Structured>
  const definitions = new Map<string, ToolDefinition>()
  runtimes.set(tool, {
    definition: (name) => {
      const cached = definitions.get(name)
      if (cached) return cached
      const def: ToolDefinition = {
        name,
        description: config.description,
        inputSchema: toJsonSchema(config.input),
        outputSchema: toJsonSchema(config.structured ?? config.output),
      }
      definitions.set(name, def)
      return def
    },
    settle: (call, context) =>
      Schema.decodeUnknownEffect(config.input)(call.input).pipe(
        Effect.mapError((error) => new ToolFailure({ message: `Invalid tool input: ${error.message}` })),
        Effect.flatMap((input) =>
          config.execute(input, context).pipe(
            Effect.flatMap((output) =>
              Schema.encodeEffect(config.output)(output).pipe(
                Effect.flatMap((encoded) => {
                  if (!config.structured || !config.toStructuredOutput)
                    return Effect.succeed({ output: encoded, structured: encoded })
                  return Schema.encodeEffect(config.structured)(
                    config.toStructuredOutput({ input, output: encoded }),
                  ).pipe(Effect.map((structured) => ({ output: encoded, structured })))
                }),
                Effect.mapError(
                  (error) =>
                    new ToolFailure({
                      message: `Tool returned an invalid value for its output schema: ${error.message}`,
                    }),
                ),
              ),
            ),
            Effect.map(({ output: encoded, structured }) => ({
              structured,
              content:
                config.toModelOutput?.({ input, output: encoded }).map((part) =>
                  part.type === "text"
                    ? { type: "text" as const, text: part.text }
                    : {
                        type: "file" as const,
                        uri: `data:${part.mime};base64,${part.data}`,
                        mime: part.mime,
                        name: part.name,
                      },
                ) ?? (typeof encoded === "string" ? [{ type: "text" as const, text: encoded }] : []),
            })),
          ),
        ),
      ),
  })
  return tool
}

export const validateName = (name: string) =>
  /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)
    ? Effect.void
    : Effect.fail(new RegistrationError({ name, message: `Invalid tool name: ${name}` }))

export const withPermission = <Input extends SchemaType<any>, Output extends SchemaType<any>>(
  tool: Definition<Input, Output>,
  perm: string,
): Definition<Input, Output> => {
  const decorated = Object.freeze({}) as Definition<Input, Output>
  runtimes.set(decorated, { ...runtimeOf(tool), permission: perm })
  return decorated
}

export const permission = (tool: AnyTool, name: string) => runtimeOf(tool).permission ?? name
export const definition = (name: string, tool: AnyTool) => runtimeOf(tool).definition(name)
export const settle = (tool: AnyTool, call: ToolCall, context: ToolContext) => runtimeOf(tool).settle(call, context)

function runtimeOf(tool: AnyTool): Runtime {
  const runtime = runtimes.get(tool)
  if (!runtime) throw new TypeError("Invalid Tool value")
  return runtime
}

function toJsonSchema(schema: Schema.Top): JsonSchema.JsonSchema {
  const document = Schema.toJsonSchemaDocument(schema)
  if (Object.keys(document.definitions).length === 0) return document.schema
  return { ...document.schema, $defs: document.definitions }
}
