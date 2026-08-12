/**
 * QuestionStore — in-process store for pending QuestionTool requests.
 *
 * Implements IQuestionService so it can be passed directly to
 * QuestionTool.makeQuestionTool(). Also exposes list/reply/reject so
 * the HTTP layer (tui-server) can surface pending questions and relay
 * user answers back into the blocked Effect fiber.
 */

import { Effect } from "effect"
import type { Question } from "@gco/schema"
import type { IQuestionService, QuestionAskInput } from "./tools/QuestionTool"

interface PendingEntry {
  readonly id: string
  readonly sessionID: string
  readonly questions: ReadonlyArray<Question.Prompt>
  readonly tool: { readonly messageID: string; readonly callID: string }
  readonly resolve: (answers: ReadonlyArray<Question.Answer>) => void
  readonly reject: () => void
}

export interface QuestionRequestInfo {
  readonly id: string
  readonly sessionID: string
  readonly questions: ReadonlyArray<Question.Prompt>
  readonly tool: { readonly messageID: string; readonly callID: string }
}

export class QuestionStore implements IQuestionService {
  private readonly pending = new Map<string, PendingEntry>()

  ask(input: QuestionAskInput): Effect.Effect<{ answers: ReadonlyArray<Question.Answer> }> {
    return Effect.callback<{ answers: ReadonlyArray<Question.Answer> }>((resume) => {
      const id = crypto.randomUUID()
      this.pending.set(id, {
        id,
        sessionID: input.sessionID,
        questions: input.questions,
        tool: input.tool,
        resolve: (answers) => {
          this.pending.delete(id)
          resume(Effect.succeed({ answers }))
        },
        reject: () => {
          this.pending.delete(id)
          resume(Effect.succeed({ answers: [] as ReadonlyArray<Question.Answer> }))
        },
      })
    })
  }

  list(sessionID: string): QuestionRequestInfo[] {
    return [...this.pending.values()]
      .filter((p) => p.sessionID === sessionID)
      .map(({ id, sessionID: sid, questions, tool }) => ({ id, sessionID: sid, questions, tool }))
  }

  reply(requestID: string, answers: ReadonlyArray<ReadonlyArray<string>>): void {
    this.pending.get(requestID)?.resolve(answers as ReadonlyArray<Question.Answer>)
  }

  reject(requestID: string): void {
    this.pending.get(requestID)?.reject()
  }
}
