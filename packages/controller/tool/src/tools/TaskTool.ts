/**
 * TaskTool — create and track tasks (subagent sessions) within a session.
 *
 * Ported from @lotus-code/lotus-code tool/task.ts.
 * Logic kept identical — foreground/background task execution is delegated
 * to the injected TaskRunnerService context.
 */
export * as TaskTool from "./TaskTool"

import { Context, Effect, Schema } from "effect"
import { ToolFailure, make as makeTool, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "task"

const BACKGROUND_DESCRIPTION = [
  "Background mode: background=true launches the subagent asynchronously and returns immediately.",
  "Foreground is the default; use it when you need the result before continuing.",
  "Use background only for independent work that can run while you continue elsewhere.",
  "You will be notified automatically when it finishes.",
].join(" ")

export const BASE_DESCRIPTION = `Create and track a structured task for a specialized subagent.

Each task runs in its own session. Supply a clear, self-contained prompt. The subagent returns a result when done.

Use task_id to resume a previous task session instead of creating a fresh one.`

export const DESCRIPTION = [BASE_DESCRIPTION, BACKGROUND_DESCRIPTION].join("\n\n")

const BACKGROUND_STARTED = [
  "The task is working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
].join("\n")

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const Input = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "Set only to resume a previous task. The subagent will continue the same session instead of creating a fresh one.",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the agent in the background. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress",
  }),
})

export const Output = Schema.Struct({
  sessionID: Schema.String,
  state: Schema.Literals(["running", "completed", "error"]),
  summary: Schema.String.pipe(Schema.optional),
  output: Schema.String,
})
export type Output = typeof Output.Type

// ---------------------------------------------------------------------------
// Task runner service interface
// ---------------------------------------------------------------------------

export interface TaskRunInput {
  readonly description: string
  readonly prompt: string
  readonly subagentType: string
  readonly taskId?: string
  readonly command?: string
  readonly background: boolean
  readonly parentSessionID: string
  readonly parentAgent: string
  readonly toolCallID: string
}

export interface TaskRunResult {
  readonly sessionID: string
  readonly state: "running" | "completed" | "error"
  readonly summary?: string
  readonly text: string
}

export interface ITaskRunnerService {
  readonly run: (input: TaskRunInput) => Effect.Effect<TaskRunResult, Error>
}

export class TaskRunnerService extends Context.Service<TaskRunnerService, ITaskRunnerService>()(
  "@gco/TaskRunnerService",
) {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderOutput(input: {
  sessionID: string
  state: "running" | "completed" | "error"
  summary?: string
  text: string
}) {
  const tag = input.state === "error" ? "task_error" : "task_result"
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${input.summary}</summary>`] : []),
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export const makeTaskTool = (runner: ITaskRunnerService): AnyTool =>
  makeTool({
    description: DESCRIPTION,
    input: Input,
    output: Output,
    toModelOutput: ({ output }) => [
      {
        type: "text",
        text: renderOutput({
          sessionID: output.sessionID,
          state: output.state,
          summary: output.summary,
          text: output.output,
        }),
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
            command: input.command,
            background: input.background === true,
            parentSessionID: context.sessionID,
            parentAgent: context.agent,
            toolCallID: context.toolCallID,
          })
          .pipe(
            Effect.mapError(
              (e) => new ToolFailure({ message: `Task execution failed: ${e.message}` }),
            ),
          )

        if (result.state === "running") {
          return {
            sessionID: result.sessionID,
            state: "running" as const,
            summary: result.summary,
            output: BACKGROUND_STARTED,
          }
        }

        return {
          sessionID: result.sessionID,
          state: result.state,
          summary: result.summary,
          output: result.text,
        }
      }),
  })

/** Effect that builds the TaskTool using the injected TaskRunnerService. */
export const makeToolEffect: Effect.Effect<AnyTool, never, TaskRunnerService> = Effect.gen(function* () {
  const runner = yield* TaskRunnerService
  return makeTaskTool(runner)
})
