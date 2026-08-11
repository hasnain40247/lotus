/**
 * SkillTool — invoke a named skill.
 *
 * Skills are pre-defined procedures (slash commands) that the session runner
 * can execute by name. The actual lookup and execution is delegated to the
 * injected ISkillService so the tool stays decoupled from the registry layer.
 */
export * as SkillTool from "./SkillTool"

import { Context, Effect, Schema } from "effect"
import { ToolFailure, make as makeTool, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "skill"

export const description = `Invoke a named skill (slash command) by name, optionally passing arguments.

Skills are pre-defined procedures that extend the agent's capability — for example,
running a code review, generating documentation, or triggering a build pipeline step.

Use this tool when the user references a skill by name or when a task can be
delegated to a known skill procedure. Provide a self-contained prompt in args so the
skill has the context it needs.`

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const Input = Schema.Struct({
  skill: Schema.String.annotate({ description: "The name of the skill to invoke (without the leading /)" }),
  args: Schema.optional(Schema.String).annotate({
    description: "Optional arguments or prompt to pass to the skill",
  }),
})

export const Output = Schema.Struct({
  skill: Schema.String,
  output: Schema.String,
})
export type Output = typeof Output.Type

// ---------------------------------------------------------------------------
// Skill service interface
// ---------------------------------------------------------------------------

export interface SkillRunInput {
  readonly skill: string
  readonly args?: string
  readonly sessionID: string
}

export interface ISkillService {
  readonly run: (input: SkillRunInput) => Effect.Effect<{ output: string }, Error>
}

export class SkillService extends Context.Service<SkillService, ISkillService>()("@gco/SkillService") {}

// ---------------------------------------------------------------------------
// Model output helper
// ---------------------------------------------------------------------------

export const toModelOutput = (output: Output) => output.output

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export const makeSkillTool = (skillService: ISkillService): AnyTool =>
  makeTool({
    description,
    input: Input,
    output: Output,
    toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
    execute: (input, context) =>
      skillService
        .run({ skill: input.skill, args: input.args, sessionID: context.sessionID })
        .pipe(
          Effect.mapError((e) => new ToolFailure({ message: `Skill '${input.skill}' failed: ${e.message}` })),
          Effect.map((result) => ({ skill: input.skill, output: result.output })),
        ),
  })

/** Effect that builds the SkillTool using the injected SkillService. */
export const makeToolEffect: Effect.Effect<AnyTool, never, SkillService> = Effect.gen(function* () {
  const ss = yield* SkillService
  return makeSkillTool(ss)
})
