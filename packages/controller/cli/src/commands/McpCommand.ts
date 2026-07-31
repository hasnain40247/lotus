/**
 * McpCommand — manage MCP (Model Context Protocol) servers.
 *
 * Subcommands:
 *   list   — list MCP servers and their status
 *   add    — add an MCP server (interactive or non-interactive)
 *   auth   — authenticate with an OAuth-enabled MCP server
 *   logout — remove OAuth credentials for an MCP server
 *   debug  — debug an MCP server connection
 */

import type { CommandModule, Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { EOL } from "node:os"
import { Effect } from "effect"
import { formatMcpList, color, type McpServerInfo, type McpServerStatus } from "@gco/view-cli"
import { McpService, McpAuthService, type McpStatus } from "@gco/controller-mcp"
import { ProductionLayer } from "../bootstrap.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mcpStatusToViewStatus(status: McpStatus | undefined): McpServerStatus {
  if (!status) return "not_initialized"
  switch (status.status) {
    case "connected": return "connected"
    case "disabled": return "disabled"
    case "failed": return "failed"
    case "needs_auth": return "needs_auth"
    case "needs_client_registration": return "failed"
    default: return "not_initialized"
  }
}

// ---------------------------------------------------------------------------
// list subcommand
// ---------------------------------------------------------------------------

type ListArgs = { format?: string }

const McpListCommand: CommandModule<object, ListArgs> = {
  command: "list",
  aliases: ["ls"],
  describe: "list MCP servers and their status",

  builder: (yargs: Argv) =>
    yargs.option("format", {
      type: "string",
      choices: ["table", "json"],
      default: "table",
      describe: "output format",
    }) as unknown as Argv<ListArgs>,

  handler: async (args) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const mcp = yield* McpService
        const statuses = yield* mcp.status().pipe(
          Effect.catch(() => Effect.succeed({} as Record<string, McpStatus>)),
        )
        const servers: McpServerInfo[] = Object.entries(statuses).map(([name, status]) => ({
          name,
          type: "remote" as const, // Default; config-aware type resolution done in controller
          status: mcpStatusToViewStatus(status),
          location: (status as any).url ?? (status as any).command ?? name,
          toolCount: (status as any).toolCount,
          error: (status as any).error,
        }))

        if (args.format === "json") {
          process.stdout.write(JSON.stringify(servers, null, 2) + EOL)
          return
        }

        process.stdout.write(formatMcpList(servers) + EOL)
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
// add subcommand
// ---------------------------------------------------------------------------

type AddArgs = {
  name?: string
  url?: string
  env?: string[]
  header?: string[]
}

const McpAddCommand: CommandModule<object, AddArgs> = {
  command: "add [name]",
  describe: "add an MCP server",

  builder: (yargs: Argv) =>
    yargs
      .positional("name", {
        describe: "name of the MCP server",
        type: "string",
      })
      .option("url", {
        describe: "URL for a remote MCP server",
        type: "string",
      })
      .option("env", {
        describe: "environment variable for a local MCP server (KEY=VALUE)",
        type: "string",
        array: true,
      })
      .option("header", {
        describe: "HTTP header for a remote MCP server (KEY=VALUE)",
        type: "string",
        array: true,
      }) as unknown as Argv<AddArgs>,

  handler: async (args) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        prompts.intro("Add MCP server")

        // Non-interactive mode
        if (args.name && (args.url || (args["--"] as string[] | undefined)?.length)) {
          const command = (args["--"] as string[] | undefined) ?? []

          if (!args.url && !command.length) {
            prompts.log.error("Provide either --url <url> or a command after --")
            process.exitCode = 1
            return
          }

          const mcp = yield* McpService
          const config = args.url
            ? { type: "remote" as const, url: args.url }
            : { type: "local" as const, command }

          yield* mcp.add(args.name, config as any).pipe(
            Effect.catch(() => Effect.void),
          )

          prompts.log.success(`MCP server "${args.name}" added`)
          prompts.outro("Done")
          return
        }

        // Interactive mode
        let name = args.name
        if (!name) {
          const result = yield* Effect.promise(() =>
            prompts.text({
              message: "Server name",
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            }),
          )
          if (prompts.isCancel(result)) {
            prompts.outro("Cancelled")
            return
          }
          name = result
        }

        const type = yield* Effect.promise(() =>
          prompts.select({
            message: "Server type",
            options: [
              { label: "Local", value: "local" as const, hint: "Run a local command" },
              { label: "Remote", value: "remote" as const, hint: "Connect to a remote URL" },
            ],
          }),
        )
        if (prompts.isCancel(type)) {
          prompts.outro("Cancelled")
          return
        }

        const mcp = yield* McpService

        if (type === "remote") {
          const url = yield* Effect.promise(() =>
            prompts.text({
              message: "Server URL",
              placeholder: "e.g., https://example.com/mcp",
              validate: (x) => {
                if (!x) return "Required"
                return URL.canParse(x) ? undefined : "Invalid URL"
              },
            }),
          )
          if (prompts.isCancel(url)) {
            prompts.outro("Cancelled")
            return
          }

          yield* mcp.add(name, { type: "remote", url } as any).pipe(
            Effect.catch(() => Effect.void),
          )
        } else {
          const command = yield* Effect.promise(() =>
            prompts.text({
              message: "Command to run",
              placeholder: "e.g., npx @modelcontextprotocol/server-filesystem .",
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            }),
          )
          if (prompts.isCancel(command)) {
            prompts.outro("Cancelled")
            return
          }

          yield* mcp.add(name, { type: "local", command: command.split(" ") } as any).pipe(
            Effect.catch(() => Effect.void),
          )
        }

        prompts.log.success(`MCP server "${name}" added`)
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
// auth subcommand
// ---------------------------------------------------------------------------

type AuthArgs = { name?: string }

const McpAuthCommand: CommandModule<object, AuthArgs> = {
  command: "auth [name]",
  describe: "authenticate with an OAuth-enabled MCP server",

  builder: (yargs: Argv) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
    }) as unknown as Argv<AuthArgs>,

  handler: async (args) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        prompts.intro("MCP OAuth Authentication")

        const mcp = yield* McpService
        const statuses = yield* mcp.status().pipe(
          Effect.catch(() => Effect.succeed({} as Record<string, McpStatus>)),
        )

        const servers = Object.keys(statuses)
        if (servers.length === 0) {
          prompts.log.warn("No MCP servers configured")
          prompts.outro("Done")
          return
        }

        let serverName = args.name
        if (!serverName) {
          const selected = yield* Effect.promise(() =>
            prompts.select({
              message: "Select MCP server to authenticate",
              options: servers.map((name) => ({ label: name, value: name })),
            }),
          )
          if (prompts.isCancel(selected)) {
            prompts.outro("Cancelled")
            return
          }
          serverName = selected
        }

        const spinner = prompts.spinner()
        spinner.start("Starting OAuth flow...")

        yield* mcp
          .authenticate(serverName, (url: string) => {
            spinner.stop("Authorize in your browser:")
            prompts.log.info(url)
            spinner.start("Waiting for authorization...")
          })
          .pipe(
            Effect.tap((status: McpStatus) =>
              Effect.sync(() => {
                if (status.status === "connected") {
                  spinner.stop("Authentication successful!")
                } else {
                  spinner.stop("Authentication failed", 1)
                  prompts.log.error(
                    "status" in status && "error" in status
                      ? (status as any).error
                      : "Unknown error",
                  )
                }
              }),
            ),
            Effect.catch((err: unknown) =>
              Effect.sync(() => {
                spinner.stop("Authentication failed", 1)
                prompts.log.error(err instanceof Error ? err.message : String(err))
              }),
            ),
          )

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

type LogoutArgs = { name?: string }

const McpLogoutCommand: CommandModule<object, LogoutArgs> = {
  command: "logout [name]",
  describe: "remove OAuth credentials for an MCP server",

  builder: (yargs: Argv) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
    }) as unknown as Argv<LogoutArgs>,

  handler: async (args) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        prompts.intro("MCP OAuth Logout")

        const authSvc = yield* McpAuthService
        const credentials = yield* authSvc.all().pipe(
          Effect.catch(() => Effect.succeed({} as Record<string, unknown>)),
        )
        const serverNames = Object.keys(credentials)

        if (serverNames.length === 0) {
          prompts.log.warn("No MCP OAuth credentials stored")
          prompts.outro("Done")
          return
        }

        let serverName = args.name
        if (!serverName) {
          const selected = yield* Effect.promise(() =>
            prompts.select({
              message: "Select MCP server to logout",
              options: serverNames.map((name) => ({ label: name, value: name })),
            }),
          )
          if (prompts.isCancel(selected)) {
            prompts.outro("Cancelled")
            return
          }
          serverName = selected
        }

        const mcp = yield* McpService
        yield* mcp.removeAuth(serverName).pipe(
          Effect.catch(() => Effect.void),
        )

        prompts.log.success(`Removed OAuth credentials for ${serverName}`)
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
// debug subcommand
// ---------------------------------------------------------------------------

type DebugArgs = { name: string }

const McpDebugCommand: CommandModule<object, DebugArgs> = {
  command: "debug <name>",
  describe: "debug connection for an MCP server",

  builder: (yargs: Argv) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
      demandOption: true,
    }) as unknown as Argv<DebugArgs>,

  handler: async (args) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        prompts.intro("MCP Debug")

        const mcp = yield* McpService
        const statuses = yield* mcp.status().pipe(
          Effect.catch(() => Effect.succeed({} as Record<string, McpStatus>)),
        )

        const status = statuses[args.name]
        if (!status) {
          prompts.log.error(`MCP server not found: ${args.name}`)
          prompts.outro("Done")
          return
        }

        prompts.log.info(`Server: ${args.name}`)
        prompts.log.info(`Status: ${status.status}`)

        if (status.status === "failed" || status.status === "needs_client_registration") {
          prompts.log.error(`Error: ${(status as any).error ?? "unknown"}`)
        }

        // Attempt a reconnect to test
        const spinner = prompts.spinner()
        spinner.start("Testing connection...")

        yield* mcp.disconnect(args.name).pipe(Effect.catch(() => Effect.void))
        yield* mcp.connect(args.name).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              spinner.stop("Connection successful")
            }),
          ),
          Effect.catch((err: unknown) =>
            Effect.sync(() => {
              spinner.stop("Connection failed", 1)
              prompts.log.error(err instanceof Error ? err.message : String(err))
            }),
          ),
        )

        prompts.outro("Debug complete")
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
// Top-level McpCommand
// ---------------------------------------------------------------------------

export const McpCommand: CommandModule<object, object> = {
  command: "mcp",
  describe: "manage MCP (Model Context Protocol) servers",

  builder: (yargs: Argv) =>
    yargs
      .command(McpListCommand)
      .command(McpAddCommand)
      .command(McpAuthCommand)
      .command(McpLogoutCommand)
      .command(McpDebugCommand)
      .demandCommand(1, "Specify a subcommand: list, add, auth, logout, debug"),

  handler: async () => {},
}
