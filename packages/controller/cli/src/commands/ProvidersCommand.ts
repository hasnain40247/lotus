/**
 * ProvidersCommand — manage AI providers and credentials.
 *
 * Only the 4 supported providers are handled:
 *   anthropic, vertex-ai, deepseek, ollama
 *
 * Subcommands:
 *   list   — list providers + auth status
 *   login  — store credentials for a provider
 *   logout — remove stored credentials
 */

import type { CommandModule, Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { EOL } from "node:os"
import { Effect } from "effect"
import { formatProviderList, color, type ProviderInfo } from "@gco/view-cli"
import { CredentialRepository } from "@gco/model-domain"
import type { Integration, Credential } from "@gco/schema"
import { ProductionLayer } from "../bootstrap.js"

// ---------------------------------------------------------------------------
// Supported providers
// ---------------------------------------------------------------------------

const SUPPORTED_PROVIDERS: ReadonlyArray<{
  readonly id: string
  readonly name: string
  readonly authKind: "api-key" | "oauth" | "local" | "adc"
}> = [
  { id: "anthropic",  name: "Anthropic",  authKind: "api-key" },
  { id: "vertex-ai",  name: "Vertex AI",  authKind: "adc"     },
  { id: "deepseek",   name: "DeepSeek",   authKind: "api-key" },
  { id: "ollama",     name: "Ollama",     authKind: "local"   },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIntegrationID(id: string): Integration.ID {
  return id as unknown as Integration.ID
}

// ---------------------------------------------------------------------------
// list subcommand
// ---------------------------------------------------------------------------

const ProvidersListCommand: CommandModule<object, object> = {
  command: "list",
  aliases: ["ls"],
  describe: "list providers and credentials",

  handler: async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const credRepo = yield* CredentialRepository

        const allCreds = yield* credRepo.all().pipe(
          Effect.catch(() => Effect.succeed([] as any[])),
        )

        const credsByIntegration = new Set(allCreds.map((c: any) => String(c.integrationID)))

        const providers: ProviderInfo[] = SUPPORTED_PROVIDERS.map((p) => ({
          id: p.id,
          name: p.name,
          hasKey: p.authKind === "local" || credsByIntegration.has(p.id),
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
  describe: "log in to a provider",

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
        prompts.intro("Add credential")

        let providerID = args.provider

        if (!providerID) {
          const selected = yield* Effect.promise(() =>
            prompts.select({
              message: "Select provider",
              options: SUPPORTED_PROVIDERS.filter((p) => p.authKind !== "local").map((p) => ({
                label: p.name,
                value: p.id,
                hint:
                  p.authKind === "adc"
                    ? "uses Application Default Credentials"
                    : undefined,
              })),
            }),
          )
          if (prompts.isCancel(selected)) {
            prompts.outro("Cancelled")
            return
          }
          providerID = selected
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

        if (provider.authKind === "adc") {
          prompts.log.info(
            `${provider.name} uses Application Default Credentials (ADC).` +
              EOL +
              `Run: gcloud auth application-default login`,
          )
          prompts.outro("Done")
          return
        }

        // api-key flow
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

        const credRepo = yield* CredentialRepository
        yield* credRepo
          .create({
            integrationID: toIntegrationID(providerID),
            label: `${provider.name} API Key`,
            value: { type: "key", key: apiKey } satisfies Credential.Key,
          })
          .pipe(Effect.catch(() => Effect.void))

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
  describe: "log out from a configured provider",

  builder: (yargs: Argv) =>
    yargs.positional("provider", {
      describe: "provider ID to log out from",
      type: "string",
    }) as unknown as Argv<LogoutArgs>,

  handler: async (args) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        prompts.intro("Remove credential")

        const credRepo = yield* CredentialRepository
        const credentials = yield* credRepo.all().pipe(
          Effect.catch(() => Effect.succeed([] as any[])),
        )

        if (credentials.length === 0) {
          prompts.log.warn("No credentials found")
          prompts.outro("Done")
          return
        }

        let providerID = args.provider
        if (!providerID) {
          const selected = yield* Effect.promise(() =>
            prompts.select({
              message: "Select provider to log out",
              options: credentials.map((c: any) => ({
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

        // Remove all credentials for this provider
        const toRemove = credentials.filter(
          (c: any) => String(c.integrationID) === providerID,
        )
        for (const cred of toRemove) {
          yield* credRepo.remove(cred.id as Credential.ID).pipe(Effect.catch(() => Effect.void))
        }

        prompts.log.success(`Logged out from ${providerID}`)
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
  describe: "manage AI providers and credentials",

  builder: (yargs: Argv) =>
    yargs
      .command(ProvidersListCommand)
      .command(ProvidersLoginCommand)
      .command(ProvidersLogoutCommand)
      .demandCommand(1, "Specify a subcommand: list, login, logout"),

  handler: async () => {},
}
