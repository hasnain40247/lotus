/**
 * AgentTool — spawn a subagent for a subtask.
 *
 * Provides a tool that the model can use to delegate a subtask to a specialized
 * subagent. The actual agent execution must be wired by the caller via the
 * AgentRunnerService context.
 */
export * as AgentTool from "./AgentTool"

import { Context, Effect, Schema } from "effect"
import { ToolFailure, make as makeTool, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "agent"

export const DESCRIPTION = `Spawn a specialized subagent to complete a self-contained subtask.

Use this when a task is well-scoped and can run independently. The subagent works in its own session and returns a result when done. Pass a clear, self-contained prompt so the subagent has everything it needs.

Do not use this to duplicate work the current agent is already performing. Provide a task_id to resume a previous subagent session.`

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const Input = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the subagent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "Set to resume a previous task. Pass a prior task_id and the task will continue the same subagent session instead of creating a fresh one.",
  }),
})

export const Output = Schema.Struct({
  sessionID: Schema.String,
  state: Schema.Literals(["completed", "error"]),
  output: Schema.String,
})
export type Output = typeof Output.Type

// ---------------------------------------------------------------------------
// Agent runner service interface
// ---------------------------------------------------------------------------

export interface AgentRunInput {
  readonly description: string
  readonly prompt: string
  readonly subagentType: string
  readonly taskId?: string
  readonly parentSessionID: string
}

export interface AgentRunResult {
  readonly sessionID: string
  readonly output: string
  readonly error?: string
}

export interface IAgentRunnerService {
  readonly run: (input: AgentRunInput) => Effect.Effect<AgentRunResult, Error>
}

export class AgentRunnerService extends Context.Service<AgentRunnerService, IAgentRunnerService>()(
  "@gco/AgentRunnerService",
) {}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

function renderOutput(input: { sessionID: string; state: "completed" | "error"; text: string }) {
  const tag = input.state === "error" ? "task_error" : "task_result"
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

export const makeAgentTool = (runner: IAgentRunnerService): AnyTool =>
  makeTool({
    description: DESCRIPTION,
    input: Input,
    output: Output,
    toModelOutput: ({ output }) => [
      {
        type: "text",
        text: renderOutput({ sessionID: output.sessionID, state: output.state, text: output.output }),
      },
    ],
    execute: (input, context) =>
      Effect.gen(function* () {
        const result = yield* runner
          .run({
            description: input.description,
            prompt: input.prompt,
            subagentType: input.subagent_type,
            taskId: input.task_id,
            parentSessionID: context.sessionID,
          })
          .pipe(
            Effect.mapError(
              (e) => new ToolFailure({ message: `Subagent execution failed: ${e.message}` }),
            ),
          )

        if (result.error) {
          return {
            sessionID: result.sessionID,
            state: "error" as const,
            output: result.error,
          }
        }

        return {
          sessionID: result.sessionID,
          state: "completed" as const,
          output: result.output,
        }
      }),
  })

/** Effect that builds the AgentTool using the injected AgentRunnerService. */
export const makeToolEffect: Effect.Effect<AnyTool, never, AgentRunnerService> = Effect.gen(function* () {
  const runner = yield* AgentRunnerService
  return makeAgentTool(runner)
})
