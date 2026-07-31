/**
 * AgentCommand — manage agents.
 *
 * Subcommands:
 *   list   — list all available agents
 *   create — create a new agent (interactive or non-interactive)
 */

import type { CommandModule, Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { EOL } from "node:os"
import { Effect } from "effect"
import { formatAgentList, formatAgentDetail, color, type AgentInfo } from "@gco/view-cli"
import { AgentService, type AgentDraft, type AgentInfo as AgentInfoShape } from "@gco/controller-agent"
import type { Agent } from "@gco/schema"
import { ProductionLayer } from "../bootstrap.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toAgentInfo(agent: Agent.Info): AgentInfo {
  const permissionSummary = (agent.permissions ?? []).map((rule: any) => {
    const action = rule.action ?? "allow"
    const permission = rule.permission ?? rule.tool ?? "unknown"
    return `${permission}: ${action}`
  })

  return {
    id: String(agent.id),
    mode: agent.mode ?? "all",
    modelOverride: (agent as any).model
      ? `${(agent as any).model.providerID}/${(agent as any).model.id}`
      : undefined,
    description: (agent as any).description,
    permissionSummary,
    hidden: agent.hidden ?? false,
  }
}

// ---------------------------------------------------------------------------
// list subcommand
// ---------------------------------------------------------------------------

type ListArgs = { verbose?: boolean }

const AgentListCommand: CommandModule<object, ListArgs> = {
  command: "list",
  aliases: ["ls"],
  describe: "list all available agents",

  builder: (yargs: Argv) =>
    yargs.option("verbose", {
      alias: ["v"],
      type: "boolean",
      describe: "show full agent detail",
      default: false,
    }) as unknown as Argv<ListArgs>,

  handler: async (args) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const agentSvc = yield* AgentService
        const agents = yield* agentSvc.all()

        if (args.verbose) {
          for (const agent of agents) {
            process.stdout.write(formatAgentDetail(toAgentInfo(agent)) + EOL + EOL)
          }
          return
        }

        process.stdout.write(
          formatAgentList(agents.map(toAgentInfo)) + EOL,
        )
      }).pipe(Effect.provide(ProductionLayer)),
    )
  },
}

// ---------------------------------------------------------------------------
// create subcommand
// ---------------------------------------------------------------------------

type CreateArgs = {
  name?: string
  description?: string
  mode?: string
}

const AgentCreateCommand: CommandModule<object, CreateArgs> = {
  command: "create [name]",
  describe: "create a new agent",

  builder: (yargs: Argv) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "agent identifier",
      })
      .option("description", {
        type: "string",
        describe: "what the agent should do",
      })
      .option("mode", {
        type: "string",
        describe: "agent mode",
        choices: ["all", "primary", "subagent"],
      }) as unknown as Argv<CreateArgs>,

  handler: async (args) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        prompts.intro("Create agent")

        let name = args.name
        if (!name) {
          const result = yield* Effect.promise(() =>
            prompts.text({
              message: "Agent identifier",
              placeholder: "e.g., code-reviewer",
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            }),
          )
          if (prompts.isCancel(result)) {
            prompts.outro("Cancelled")
            return
          }
          name = result
        }

        let description = args.description
        if (!description) {
          const result = yield* Effect.promise(() =>
            prompts.text({
              message: "Description",
              placeholder: "What should this agent do?",
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            }),
          )
          if (prompts.isCancel(result)) {
            prompts.outro("Cancelled")
            return
          }
          description = result
        }

        let mode = args.mode as "all" | "primary" | "subagent" | undefined
        if (!mode) {
          const result = yield* Effect.promise(() =>
            prompts.select({
              message: "Agent mode",
              options: [
                {
                  label: "All",
                  value: "all" as const,
                  hint: "Can function in both primary and subagent roles",
                },
                {
                  label: "Primary",
                  value: "primary" as const,
                  hint: "Acts as a primary/main agent",
                },
                {
                  label: "Subagent",
                  value: "subagent" as const,
                  hint: "Can be used as a subagent by other agents",
                },
              ],
              initialValue: "all" as const,
            }),
          )
          if (prompts.isCancel(result)) {
            prompts.outro("Cancelled")
            return
          }
          mode = result
        }

        const agentSvc = yield* AgentService
        yield* agentSvc.transform((draft: AgentDraft) => {
          draft.update(name as any, (agent: AgentInfoShape) => {
            ;(agent as any).description = description
            ;(agent as any).mode = mode
          })
        })

        prompts.log.success(`Agent "${name}" created with mode "${mode}"`)
        prompts.outro("Done")
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
  },
}

// ---------------------------------------------------------------------------
// Top-level AgentCommand
// ---------------------------------------------------------------------------

export const AgentCommand: CommandModule<object, object> = {
  command: "agent",
  describe: "manage agents",

  builder: (yargs: Argv) =>
    yargs
      .command(AgentListCommand)
      .command(AgentCreateCommand)
      .demandCommand(1, "Specify a subcommand: list, create"),

  handler: async () => {},
}
