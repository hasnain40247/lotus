/**
 * GenerateCommand — code generation via LLM.
 *
 * Accepts a natural-language description and generates code using the
 * configured LLM. Output is written to stdout.
 */

import type { CommandModule, Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { EOL } from "node:os"
import { Effect } from "effect"
import { color } from "@gco/view-cli"
import { SessionController } from "@gco/controller-session"
import { ProductionLayer } from "../bootstrap.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GenerateArgs = {
  description?: string
  model?: string
  output?: string
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function generateHandler(args: GenerateArgs): Promise<void> {
  await Effect.runPromise(
    Effect.gen(function* () {
      let description = args.description

      if (!description) {
        prompts.intro("Generate code")

        const result = yield* Effect.promise(() =>
          prompts.text({
            message: "What do you want to generate?",
            placeholder: "e.g., A TypeScript function to parse CSV files",
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
          }),
        )

        if (prompts.isCancel(result)) {
          prompts.outro("Cancelled")
          return
        }

        description = result
        prompts.outro("Generating...")
      }

      const controller = yield* SessionController
      const spinner = prompts.spinner()
      spinner.start("Creating session...")

      const session = yield* controller.create({
        projectID: "default",
        title: `Generate: ${description.slice(0, 50)}`,
        model: args.model
          ? (() => {
              const parts = args.model!.split("/")
              const providerID = parts[0] as string
              const id = parts.slice(1).join("/")
              return { providerID, id }
            })()
          : undefined,
        location: { directory: process.cwd() },
      })

      spinner.stop("Session created")
      spinner.start("Generating...")

      yield* controller.prompt({
        sessionID: session.id,
        text: description,
      })

      spinner.stop("Done")

      if (args.output) {
        process.stderr.write(
          color.gray(`Output would be written to: ${args.output}`) + EOL,
        )
      }
    }).pipe(
      Effect.catch((err: unknown) => {
        process.stderr.write(
          color.red("Error: ") +
            (err instanceof Error ? err.message : String(err)) +
            EOL,
        )
        process.exitCode = 1
        return Effect.void
      }),
      Effect.provide(ProductionLayer),
    ),
  )
}

// ---------------------------------------------------------------------------
// Command export
// ---------------------------------------------------------------------------

export const GenerateCommand: CommandModule<object, GenerateArgs> = {
  command: "generate [description..]",
  describe: "generate code via LLM",

  builder: (yargs: Argv) =>
    yargs
      .positional("description", {
        describe: "what to generate",
        type: "string",
        array: true,
      })
      .option("model", {
        alias: ["m"],
        type: "string",
        describe: "model to use in the format of provider/model",
      })
      .option("output", {
        alias: ["o"],
        type: "string",
        describe: "output file path (defaults to stdout)",
      }) as unknown as Argv<GenerateArgs>,

  handler: (args) => {
    const descriptionParts = (args as any).description
    const description = Array.isArray(descriptionParts)
      ? descriptionParts.join(" ")
      : descriptionParts
    return generateHandler({ ...args, description })
  },
}
