/**
 * TuiCommand — launches the lotus-code TUI.
 *
 * Default command ($0) — runs when you invoke `lotus-code` with no subcommand.
 * Starts the SolidJS + OpenTUI interface via @gco/view-tui.
 *
 * All services (SessionController, EventRepository, AgentController) are
 * yielded inside a single Effect.gen so their Firestore connections stay
 * alive for the full TUI session. The concrete method implementations are
 * extracted as Promise-returning functions and handed to the HTTP server.
 */

import type { CommandModule, Argv } from "yargs"
import path from "node:path"
import { Cause, Effect, ManagedRuntime } from "effect"
import { run, type TuiInput } from "@gco/view-tui"
import { resolve as resolveTuiConfig } from "@gco/view-tui/config"
import { SessionController } from "@gco/controller-session"
import { CredentialRepository, EventRepository, SessionRepository, ProjectRepository } from "@gco/model-domain"
import { McpController } from "@gco/controller-mcp"
import { QuestionTool, ToolRegistryService } from "@gco/controller-tool"
import { QuestionStore } from "@gco/controller-tool/QuestionStore"
import { AgentRegistry } from "@gco/controller-agent"
import { ProductionLayer } from "../bootstrap.js"
import { startTuiServer, type TuiServerServices } from "../tui-server.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveDirectory(project?: string): string {
  const root = process.env.PWD ?? process.cwd()
  if (!project) return path.resolve(root)
  return path.resolve(path.isAbsolute(project) ? project : path.join(root, project))
}

async function resolveInitialPrompt(value?: string): Promise<string | undefined> {
  const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
  if (!value && !piped) return undefined
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

function defaultTuiConfig(): TuiInput["config"] {
  return resolveTuiConfig({}, { terminalSuspend: process.platform !== "win32" })
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

type TuiArgs = {
  project?: string
  model?: string
  prompt?: string
  agent?: string
  auto: boolean
  yolo: boolean
  "dangerously-skip-permissions": boolean
  "replay-limit"?: number
  demo?: boolean
}

export const TuiCommand: CommandModule<object, TuiArgs> = {
  command: "$0 [project]",
  describe: "start lotus-code TUI",

  builder: (yargs: Argv) =>
    yargs
      .positional("project", { type: "string", describe: "path to start lotus-code in" })
      .option("model", { type: "string", alias: ["m"], describe: "model to use (provider/model-id)" })
      .option("prompt", { type: "string", describe: "initial prompt to send" })
      .option("agent", { type: "string", describe: "agent to use" })
      .option("auto", {
        type: "boolean",
        describe: "auto-approve all permissions (dangerous!)",
        default: false,
      })
      .option("yolo", { type: "boolean", hidden: true, default: false })
      .option("dangerously-skip-permissions", { type: "boolean", hidden: true, default: false })
      .option("replay-limit", { type: "number", describe: "cap TUI replay to newest N messages" })
      .option("demo", { type: "boolean", hidden: true }) as unknown as Argv<TuiArgs>,

  handler: async (args) => {
    const directory = resolveDirectory(args.project)
    try {
      process.chdir(directory)
    } catch {
      process.stderr.write(`Failed to change directory to ${directory}\n`)
      process.exit(1)
    }

    const prompt = await resolveInitialPrompt(args.prompt)
    const autoApprove = args.auto || args.yolo || args["dangerously-skip-permissions"]
    const cwd = process.cwd()

    // Single long-lived ManagedRuntime — all service calls share this scope.
    // This is critical for prompt(): the runner is a daemon fiber inside
    // sessionCtrl.prompt(). Using rt.runFork() keeps it alive in this
    // runtime rather than killing it when a short-lived runPromise resolves.
    const rt = ManagedRuntime.make(ProductionLayer)

    try {
      const sessionCtrl  = await rt.runPromise(SessionController)
      const eventRepo    = await rt.runPromise(EventRepository)
      const sessionRepo  = await rt.runPromise(SessionRepository)
      const projectRepo  = await rt.runPromise(ProjectRepository)
      const credRepo     = await rt.runPromise(CredentialRepository)
      const mcpCtrl      = await rt.runPromise(McpController.Service)
      const toolRegistry = await rt.runPromise(ToolRegistryService)

      // Load stored API keys into env vars so ModelResolver picks them up
      const storedCreds = await rt.runPromise(credRepo.all()).catch(() => [] as any[])
      for (const cred of storedCreds) {
        if ((cred as any).value?.type === "key" && (cred as any).value?.key) {
          const pid = String((cred as any).integrationID)
          if (pid === "deepseek")  process.env.DEEPSEEK_API_KEY  = (cred as any).value.key
          if (pid === "anthropic") process.env.ANTHROPIC_API_KEY = (cred as any).value.key
        }
      }

      // Register QuestionTool with a shared in-process store
      const questionStore = new QuestionStore()
      await rt.runPromise(
        toolRegistry.register({ question: QuestionTool.makeQuestionTool(questionStore) }),
      ).catch(() => {})

      // Load MCP configs from lotus-code.json at startup
      const cfgFile = Bun.file(path.join(directory, "lotus-code.json"))
      const cfg = await cfgFile.exists() ? await cfgFile.json().catch(() => ({})) : {}
      if (cfg.mcp && typeof cfg.mcp === "object") {
        rt.runFork(mcpCtrl.loadConfig(cfg.mcp, directory))
      }

      const services: TuiServerServices = {
        createSession: (input) => rt.runPromise(sessionCtrl.create(input as any)),
        getSession:    (id)    => rt.runPromise(sessionCtrl.get(id as any)),
        listSessions:  (pid)   => rt.runPromise(sessionCtrl.list(pid)),

        prompt: (input) => {
          process.stderr.write(`[runner] forking for session ${input.sessionID}\n`)
          const fiber = rt.runFork(
            Effect.gen(function* () {
              process.stderr.write(`[runner] fiber started for ${input.sessionID}\n`)
              yield* sessionCtrl.prompt({
                sessionID: input.sessionID as any,
                text:      input.text,
                files:     input.files as any,
                id:        input.id as any,
              })
              process.stderr.write(`[runner] prompt admitted for ${input.sessionID}\n`)
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.sync(() => {
                  process.stderr.write(`[runner] fiber failed for ${input.sessionID}:\n${Cause.pretty(cause)}\n`)
                }),
              ),
            ),
          )
          void fiber
          return Promise.resolve()
        },

        loadEvents:     (sid) => rt.runPromise(eventRepo.load(sid as any)),
        archiveSession: (sid) =>
          rt.runPromise(sessionCtrl.interrupt(sid as any))
            .catch(() => {})
            .then(() => rt.runPromise(sessionRepo.archive(sid as any)))
            .catch(() => {}),

        abortSession: (sid) =>
          rt.runPromise(sessionCtrl.interrupt(sid as any)).catch(() => {}),

        updateSession: async (sid, patch) => {
          await rt.runPromise(sessionRepo.update(sid as any, patch as any)).catch(() => {})
          return rt.runPromise(sessionCtrl.get(sid as any)).catch(() => null)
        },

        forkSession: async (sid) => {
          const parent = await rt.runPromise(sessionCtrl.get(sid as any)).catch(() => null)
          if (!parent) return null
          const projectID = (parent as any).projectID ?? encodeURIComponent(cwd)
          return rt.runPromise(sessionCtrl.create({
            projectID,
            title: `Fork of ${(parent as any).title ?? sid}`,
            agent: (parent as any).agent,
            model: (parent as any).model ?? { id: "deepseek-chat", providerID: "deepseek" },
            location: { directory: (parent as any).location?.directory ?? cwd },
          })).catch(() => null)
        },

        revertSession: (sid, messageID) =>
          rt.runPromise(sessionCtrl.revert(sid as any, messageID as any)).catch(() => {}),
        listAgents: async () => {
          const cfgPath = path.join(directory, "lotus-code.json")
          const file = Bun.file(cfgPath)
          const cfg = await file.exists() ? await file.json().catch(() => ({})) : {}
          const overrides: Record<string, AgentRegistry.AgentOverride> = cfg.agents ?? {}
          return [...AgentRegistry.merge(overrides).values()]
        },

        listSkills: async () => {
          const skillsDir = path.join(directory, "skills")
          try {
            const glob = new Bun.Glob("*.md")
            const skills: Array<{ id: string; name: string; description: string; body: string }> = []
            for await (const file of glob.scan({ cwd: skillsDir, absolute: false })) {
              const name = file.replace(/\.md$/, "")
              const body = await Bun.file(path.join(skillsDir, file)).text()
              const description = body.split("\n").find((l) => l.trim()) ?? ""
              skills.push({ id: name, name, description, body })
            }
            return skills.sort((a, b) => a.name.localeCompare(b.name))
          } catch {
            return []
          }
        },

        listTools: () =>
          rt.runPromise(
            toolRegistry.materialize().pipe(
              Effect.map((m) =>
                m.definitions.map((d) => ({ name: d.name, description: d.description ?? "" })),
              ),
            ),
          ).catch(() => []),

        listMcpServers: async () => {
          const [statusMap, configMap, defsMap] = await Promise.all([
            rt.runPromise(mcpCtrl.status()).catch(() => ({} as Record<string, any>)),
            rt.runPromise(mcpCtrl.config()).catch(() => ({} as Record<string, any>)),
            rt.runPromise(mcpCtrl.serverDefs()).catch(() => ({} as Record<string, string[]>)),
          ])
          return Object.keys(configMap).map((name) => {
            const st = statusMap[name] ?? { status: "disabled" }
            return {
              id: name,
              name,
              status: (st as any).status,
              ...(((st as any).error) ? { error: (st as any).error } : {}),
              config: configMap[name],
              tools: defsMap[name] ?? [],
            }
          })
        },

        listProjects: () =>
          rt.runPromise(projectRepo.list()).then((ps) =>
            ps.map((p: any) => ({
              id: String(p.id),
              worktree: p.worktree ?? p.directory ?? "",
              time: {
                created: typeof p.time?.created === "number" ? p.time.created
                  : p.time?.created?.epochMillis ?? Date.now(),
                updated: typeof p.time?.updated === "number" ? p.time.updated
                  : p.time?.updated?.epochMillis ?? Date.now(),
              },
            })),
          ).catch(() => []),

        addMcp: (name, config) =>
          rt.runPromise(mcpCtrl.add(name, config as any)).then((r) => r.status as any).catch((e) => ({ error: String(e) })),

        connectMcp: (name) =>
          rt.runPromise(mcpCtrl.connect(name as any)).catch(() => {}),

        disconnectMcp: (name) =>
          rt.runPromise(mcpCtrl.disconnect(name as any)).catch(() => {}),

        listCredentials: async () => {
          const creds = await rt.runPromise(credRepo.all()).catch(() => [] as any[])
          return creds.map((c: any) => ({ integrationID: String(c.integrationID) }))
        },

        setProviderKey: async (providerID: string, key: string) => {
          const creds = await rt.runPromise(credRepo.all()).catch(() => [] as any[])
          const existing = creds.find((c: any) => String(c.integrationID) === providerID)
          if (existing) {
            await rt.runPromise(
              credRepo.update((existing as any).id, { value: { type: "key", key } as any }),
            ).catch(() => {})
          } else {
            await rt.runPromise(
              credRepo.create({
                integrationID: providerID as any,
                label: `${providerID} API Key`,
                value: { type: "key", key } as any,
              }),
            ).catch(() => {})
          }
          if (providerID === "deepseek")  process.env.DEEPSEEK_API_KEY  = key
          if (providerID === "anthropic") process.env.ANTHROPIC_API_KEY = key
        },

        listQuestions:  (sessionID) => Promise.resolve(questionStore.list(sessionID)),
        replyQuestion:  (requestID, answers) => { questionStore.reply(requestID, answers); return Promise.resolve() },
        rejectQuestion: (requestID) => { questionStore.reject(requestID); return Promise.resolve() },
      }

      const server = startTuiServer(cwd, services)

      const tuiInput: TuiInput = {
        url:       `http://localhost:${server.port}`,
        config:    defaultTuiConfig(),
        directory: cwd,
        args: {
          agent:  args.agent,
          model:  args.model ?? "deepseek/deepseek-chat",
          prompt,
          auto:   autoApprove,
        },
      }

      try {
        await rt.runPromise(run(tuiInput) as any)
      } finally {
        server.stop(true)
      }
    } finally {
      await rt.dispose()
    }

    process.exit(0)
  },
}
