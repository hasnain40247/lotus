/**
 * ToolRegistry — holds a Map of tool definitions keyed by name.
 *
 * Ported from @opencode-ai/core registry.ts.
 *
 *   register(tool)              — adds a tool (scope-finalizer removes it)
 *   materialize(ruleset?)       — returns definitions filtered by permission ruleset
 *   settle(executeInput)        — executes a tool call and returns the result
 */
export * as ToolRegistry from "./ToolRegistry"

import { Context, Effect, Layer, Scope } from "effect"
import {
  type AnyTool,
  type RegistrationError,
  type ToolCall,
  type ToolContext,
  type ToolDefinition,
  type ToolOutput,
  type ToolResultValue,
  definition,
  permission,
  settle,
  validateName,
} from "./Tool"

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export interface ExecuteInput {
  readonly sessionID: string
  readonly agent: string
  readonly assistantMessageID: string
  readonly call: ToolCall
}

export interface Materialization {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly settle: (input: ExecuteInput) => Effect.Effect<Settlement>
}

export interface Settlement {
  readonly result: ToolResultValue
  readonly output?: ToolOutput
  readonly outputPaths?: ReadonlyArray<string>
}

export interface ToolOutputBound {
  readonly output: ToolOutput
  readonly outputPaths: ReadonlyArray<string>
}

export type PermissionRule = {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "deny"
}
export type PermissionRuleset = ReadonlyArray<PermissionRule>

export interface Interface {
  readonly materialize: (permissions?: PermissionRuleset) => Effect.Effect<Materialization>
  readonly register: (
    tools: Readonly<Record<string, AnyTool>>,
  ) => Effect.Effect<void, RegistrationError, Scope.Scope>
}

// ---------------------------------------------------------------------------
// Context.Tag
// ---------------------------------------------------------------------------

export class Service extends Context.Service<Service, Interface>()("@gco/ToolRegistry") {}

// ---------------------------------------------------------------------------
// Wildcard helper (same as original)
// ---------------------------------------------------------------------------

function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern === "*") return true
  if (!pattern.includes("*")) return pattern === value
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`).test(value)
}

function whollyDisabled(action: string, rules: PermissionRuleset): boolean {
  const rule = [...rules].reverse().find((r) => wildcardMatch(action, r.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

// ---------------------------------------------------------------------------
// Bounded output helper
// (mirrors ToolOutputStore.bound in original — keeps large structured outputs
//  from blowing up the result; we expose a simple passthrough here)
// ---------------------------------------------------------------------------

function toResultValue(output: ToolOutput): ToolResultValue {
  const text = output.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n")
  return text.length > 0 ? { type: "text", value: text } : { type: "text", value: "" }
}

function boundOutput(output: ToolOutput): ToolOutputBound {
  return { output, outputPaths: [] }
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

const registryLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    type Registration = { readonly identity: object; readonly tool: AnyTool }
    const local = new Map<string, Array<{ readonly token: object; readonly registration: Registration }>>()

    const settleWith = (input: ExecuteInput, advertised?: object) =>
      Effect.gen(function* () {
        const registration = local.get(input.call.name)?.at(-1)?.registration
        if (!registration)
          return {
            result: {
              type: "error" as const,
              value: advertised ? `Stale tool call: ${input.call.name}` : `Unknown tool: ${input.call.name}`,
            },
          }
        if (advertised && registration.identity !== advertised)
          return { result: { type: "error" as const, value: `Stale tool call: ${input.call.name}` } }
        const context: ToolContext = {
          sessionID: input.sessionID,
          agent: input.agent,
          assistantMessageID: input.assistantMessageID,
          toolCallID: input.call.id,
        }
        const pending = yield* settle(registration.tool, input.call, context).pipe(
          Effect.map((output) => ({ output })),
          Effect.catchTag("ToolFailure", (failure) =>
            Effect.succeed({ result: { type: "error" as const, value: failure.message } }),
          ),
        )
        if ("result" in pending) return pending
        const toolOutput = pending.output
        const bounded = boundOutput(toolOutput)
        const result = toResultValue(bounded.output)
        if (result.type === "error")
          return bounded.outputPaths.length > 0
            ? { result, outputPaths: bounded.outputPaths }
            : { result }
        return bounded.outputPaths.length > 0
          ? { result, output: bounded.output, outputPaths: bounded.outputPaths }
          : { result, output: bounded.output }
      })

    return Service.of({
      register: (tools) =>
        Effect.gen(function* () {
          const entries = Object.entries(tools)
          if (entries.length === 0) return
          yield* Effect.forEach(entries, ([name]) => validateName(name), { discard: true })
          yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const token = {}
              for (const [name, tool] of entries)
                local.set(name, [
                  ...(local.get(name) ?? []),
                  { token, registration: { identity: {}, tool } },
                ])
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  for (const [name] of entries) {
                    const registrations =
                      local.get(name)?.filter((r) => r.token !== token) ?? []
                    if (registrations.length > 0) local.set(name, registrations)
                    else local.delete(name)
                  }
                }),
              )
            }),
          )
        }),

      materialize: (permissions = []) =>
        Effect.gen(function* () {
          const registrations = new Map<string, Registration>()
          for (const [name, entries] of local) {
            const reg = entries.at(-1)?.registration
            if (reg) registrations.set(name, reg)
          }
          for (const [name, reg] of registrations)
            if (whollyDisabled(permission(reg.tool, name), permissions)) registrations.delete(name)
          return {
            definitions: Array.from(registrations, ([name, reg]) => definition(name, reg.tool)),
            settle: (input: ExecuteInput) => {
              const reg = registrations.get(input.call.name)
              if (reg) return settleWith(input, reg.identity)
              return Effect.succeed({
                result: { type: "error" as const, value: `Unknown tool: ${input.call.name}` },
              })
            },
          }
        }),
    })
  }),
)

export const layer = registryLayer
