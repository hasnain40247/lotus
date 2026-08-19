/**
 * ProvidersCommand — manage AI providers and API keys.
 *
 * Keys live in the SQLite `credentials` table (see @gco/model-local). This
 * command is a thin wrapper around `CredentialRepository`.
 *
 * Subcommands:
 *   list   — show providers + whether a key is stored
 *   login  — save an API key for a provider
 *   logout — remove a stored API key
 */

import type { CommandModule, Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { EOL } from "node:os"
import { Effect } from "effect"
import { formatProviderList, color, type ProviderInfo } from "@gco/view-cli"
import { CredentialRepository, type Credential, type Integration } from "@gco/model-domain"
import { ProductionLayer } from "../bootstrap.js"

// ---------------------------------------------------------------------------
// Supported providers
// ---------------------------------------------------------------------------

const SUPPORTED_PROVIDERS: ReadonlyArray<{
  readonly id: string
  readonly name: string
  readonly authKind: "api-key" | "local"
}> = [
  { id: "anthropic", name: "Anthropic", authKind: "api-key" },
  { id: "deepseek",  name: "DeepSeek",  authKind: "api-key" },
  { id: "openai",    name: "OpenAI",    authKind: "api-key" },
  { id: "ollama",    name: "Ollama",    authKind: "local"   },
]

function asIntegrationID(id: string): Integration.ID {
  return id as unknown as Integration.ID
}

// ---------------------------------------------------------------------------
// list subcommand
// ---------------------------------------------------------------------------

const ProvidersListCommand: CommandModule<object, object> = {
  command: "list",
  aliases: ["ls"],
  describe: "list providers and stored API keys",

  handler: async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const creds = yield* CredentialRepository
        const all = yield* creds.all().pipe(Effect.catch(() => Effect.succeed([] as any[])))
        const configured = new Set(all.map((c: any) => String(c.integrationID)))
        const providers: ProviderInfo[] = SUPPORTED_PROVIDERS.map((p) => ({
          id: p.id,
          name: p.name,
          hasKey: p.authKind === "local" || configured.has(p.id),
          authKind: p.authKind,
        }))
        process.stdout.write(EOL + formatProviderList(providers) + EOL)
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
// login subcommand
// ---------------------------------------------------------------------------

type LoginArgs = { provider?: string }

const ProvidersLoginCommand: CommandModule<object, LoginArgs> = {
  command: "login [provider]",
  describe: "save an API key for a provider",

  builder: (yargs: Argv) =>
    yargs
      .positional("provider", {
        describe: "provider ID to log in to",
        type: "string",
      })
      .option("provider", {
        alias: ["p"],
        describe: "provider ID to log in to",
        type: "string",
      }) as unknown as Argv<LoginArgs>,

  handler: async (args) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        prompts.intro("Save API key")

        let providerID = args.provider
        if (!providerID) {
          const selected = yield* Effect.promise(() =>
            prompts.select({
              message: "Select provider",
              options: SUPPORTED_PROVIDERS.filter((p) => p.authKind !== "local").map((p) => ({
                label: p.name,
                value: p.id,
              })),
            }),
          )
          if (prompts.isCancel(selected)) {
            prompts.outro("Cancelled")
            return
          }
          providerID = selected as string
        }

        const provider = SUPPORTED_PROVIDERS.find((p) => p.id === providerID)
        if (!provider) {
          prompts.log.error(`Unknown provider: ${providerID}`)
          prompts.outro("Done")
          return
        }
        if (provider.authKind === "local") {
          prompts.log.info(`${provider.name} runs locally — no credentials needed.`)
          prompts.outro("Done")
          return
        }

        const apiKey = yield* Effect.promise(() =>
          prompts.password({
            message: `Enter your ${provider.name} API key`,
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
          }),
        )
        if (prompts.isCancel(apiKey)) {
          prompts.outro("Cancelled")
          return
        }

        const creds = yield* CredentialRepository
        const existing = yield* creds
          .list(asIntegrationID(provider.id))
          .pipe(Effect.catch(() => Effect.succeed([] as any[])))
        const value: Credential.Key = { type: "key", key: apiKey as string }
        if (existing.length > 0) {
          // Replace the first record's value in place so we don't accumulate rows.
          yield* creds.update((existing[0] as any).id, { value }).pipe(Effect.catch(() => Effect.void))
        } else {
          yield* creds
            .create({
              integrationID: asIntegrationID(provider.id),
              label: `${provider.name} API Key`,
              value,
            })
            .pipe(Effect.catch(() => Effect.void))
        }

        prompts.log.success(`Saved ${provider.name} API key`)
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
// logout subcommand
// ---------------------------------------------------------------------------

type LogoutArgs = { provider?: string }

const ProvidersLogoutCommand: CommandModule<object, LogoutArgs> = {
  command: "logout [provider]",
  describe: "remove a stored API key",

  builder: (yargs: Argv) =>
    yargs.positional("provider", {
      describe: "provider ID to log out from",
      type: "string",
    }) as unknown as Argv<LogoutArgs>,

  handler: async (args) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        prompts.intro("Remove API key")

        const creds = yield* CredentialRepository
        const all = yield* creds.all().pipe(Effect.catch(() => Effect.succeed([] as any[])))
        if (all.length === 0) {
          prompts.log.warn("No API keys configured")
          prompts.outro("Done")
          return
        }

        let providerID = args.provider
        if (!providerID) {
          const selected = yield* Effect.promise(() =>
            prompts.select({
              message: "Select provider to remove",
              options: all.map((c: any) => ({
                label:
                  SUPPORTED_PROVIDERS.find((p) => p.id === String(c.integrationID))?.name ??
                  String(c.integrationID),
                value: String(c.integrationID),
              })),
            }),
          )
          if (prompts.isCancel(selected)) {
            prompts.outro("Cancelled")
            return
          }
          providerID = selected as string
        }

        const toRemove = all.filter((c: any) => String(c.integrationID) === providerID)
        for (const cred of toRemove) {
          yield* creds
            .remove((cred as any).id as Credential.ID)
            .pipe(Effect.catch(() => Effect.void))
        }

        prompts.log.success(`Removed API key for ${providerID}`)
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
// Top-level ProvidersCommand
// ---------------------------------------------------------------------------

export const ProvidersCommand: CommandModule<object, object> = {
  command: "providers",
  aliases: ["auth"],
  describe: "manage AI providers and API keys",

  builder: (yargs: Argv) =>
    yargs
      .command(ProvidersListCommand)
      .command(ProvidersLoginCommand)
      .command(ProvidersLogoutCommand)
      .demandCommand(1, "Specify a subcommand: list, login, logout"),

  handler: async () => {},
}
