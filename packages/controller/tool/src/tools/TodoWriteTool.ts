/**
 * TodoWriteTool — write TODO list tracked across turns.
 *
 * Ported from @opencode-ai/core tool/todowrite.ts.
 * Logic kept identical.
 */
export * as TodoWriteTool from "./TodoWriteTool"

import { Context, Effect, Layer, Schema } from "effect"
import { ToolFailure, make as makeTool, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "todowrite"

// ---------------------------------------------------------------------------
// Todo schema (matches @opencode-ai/core SessionTodo.Info)
// ---------------------------------------------------------------------------

export const TodoStatus = Schema.Literals(["pending", "in_progress", "completed", "cancelled"])
export type TodoStatus = typeof TodoStatus.Type

export const TodoInfo = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
  status: TodoStatus,
  priority: Schema.Literals(["high", "medium", "low"]),
})
export type TodoInfo = typeof TodoInfo.Type

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const Input = Schema.Struct({
  todos: Schema.Array(TodoInfo).annotate({ description: "The updated todo list" }),
})

export const Output = Schema.Struct({
  todos: Schema.Array(TodoInfo),
})
export type Output = typeof Output.Type

// ---------------------------------------------------------------------------
// Todo service interface
// ---------------------------------------------------------------------------

export interface ITodoService {
  readonly update: (input: { sessionID: string; todos: ReadonlyArray<TodoInfo> }) => Effect.Effect<void>
}

export class TodoService extends Context.Service<TodoService, ITodoService>()("@gco/TodoService") {}

// ---------------------------------------------------------------------------
// Model output helper
// ---------------------------------------------------------------------------

export const toModelOutput = (output: Output) => JSON.stringify(output.todos, null, 2)

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export const makeTodoWriteTool = (todoService: ITodoService): AnyTool =>
  makeTool({
    description:
      "Create and maintain a structured task list for the current coding session. Use it to track progress during multi-step work and keep todo statuses current.",
    input: Input,
    output: Output,
    toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
    execute: (input, context) =>
      Effect.gen(function* () {
        yield* todoService.update({ sessionID: context.sessionID, todos: input.todos })
        return { todos: input.todos }
      }).pipe(Effect.mapError(() => new ToolFailure({ message: "Unable to update todos" }))),
  })

/** Effect that builds the TodoWriteTool using the injected TodoService. */
export const makeToolEffect: Effect.Effect<AnyTool, never, TodoService> = Effect.gen(function* () {
  const ts = yield* TodoService
  return makeTodoWriteTool(ts)
})

/** In-memory TodoService layer for testing or standalone use. */
export const inMemoryTodoLayer = Layer.sync(TodoService, () => {
  const store = new Map<string, ReadonlyArray<TodoInfo>>()
  return TodoService.of({
    update: ({ sessionID, todos }) =>
      Effect.sync(() => {
        store.set(sessionID, todos)
      }),
  })
})
