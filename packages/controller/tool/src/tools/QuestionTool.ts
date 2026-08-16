/**
 * QuestionTool — surface a question to the user.
 *
 * Ported from @neko/core tool/question.ts.
 * Logic kept identical. The actual question-asking mechanism must be provided
 * by callers via the QuestionService context.
 */
export * as QuestionTool from "./QuestionTool"

import { Context, Effect, Layer, Schema } from "effect"
import { Question } from "@gco/schema"
import { ToolFailure, make as makeTool, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "question"

export const description = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- When \`custom\` is enabled (default), a "Type your own answer" option is added automatically; don't include "Other" or catch-all options
- Answers are returned as arrays of labels; set \`multiple: true\` to allow selecting more than one
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const Input = Schema.Struct({
  questions: Schema.Array(Question.Prompt).annotate({ description: "Questions to ask" }),
})

export const Output = Schema.Struct({
  answers: Schema.Array(Question.Answer),
})
export type Output = typeof Output.Type

// ---------------------------------------------------------------------------
// Question service interface
// ---------------------------------------------------------------------------

export interface QuestionAskInput {
  readonly sessionID: string
  readonly questions: ReadonlyArray<Question.Prompt>
  readonly tool: { readonly messageID: string; readonly callID: string }
}

export interface IQuestionService {
  readonly ask: (input: QuestionAskInput) => Effect.Effect<{ answers: ReadonlyArray<Question.Answer> }>
}

export class QuestionService extends Context.Service<QuestionService, IQuestionService>()("@gco/QuestionService") {}

// ---------------------------------------------------------------------------
// Model output helper
// ---------------------------------------------------------------------------

export const toModelOutput = (
  questions: ReadonlyArray<Question.Prompt>,
  answers: ReadonlyArray<Question.Answer>,
) => {
  const formatted = questions
    .map(
      (question, index) =>
        `"${question.question}"="${answers[index]?.length ? answers[index].join(", ") : "Unanswered"}"`,
    )
    .join(", ")
  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const makeQuestionTool = (questionService: IQuestionService): AnyTool =>
  makeTool({
    description,
    input: Input,
    output: Output,
    toModelOutput: ({ input, output }) => [
      { type: "text", text: toModelOutput(input.questions, output.answers) },
    ],
    execute: (input, context) =>
      questionService
        .ask({
          sessionID: context.sessionID,
          questions: input.questions,
          tool: { messageID: context.assistantMessageID, callID: context.toolCallID },
        })
        .pipe(
          Effect.mapError(() => new ToolFailure({ message: "Unable to ask question" })),
          Effect.map((result) => ({ answers: result.answers })),
        ),
  })

/** Effect that builds the QuestionTool using the injected QuestionService. */
export const makeToolEffect: Effect.Effect<AnyTool, never, QuestionService> = Effect.gen(function* () {
  const qs = yield* QuestionService
  return makeQuestionTool(qs)
})
