import { render, useRenderer } from "@opentui/solid"
import { registerLotusCodeSpinner } from "./component/register-spinner"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { Deferred, Effect } from "effect"
import { Flag } from "./flag"
import { ExitProvider, useExit } from "./context/exit"
import { EpilogueProvider } from "./context/epilogue"
import { createCliRenderer, RGBA, SyntaxStyle, TextAttributes, type TextareaRenderable, type KeyEvent } from "@opentui/core"
import {
  Switch,
  Match,
  ErrorBoundary,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  For,
  Index,
  Show,
} from "solid-js"
import { createStore } from "solid-js/store"
import { ErrorComponent } from "./component/error-component"
import { SDKProvider, useSDK } from "./context/sdk"
import { registerLotusCodeKeymap } from "./keymap"
import { SlashPalette, PALETTE_VIEWPORT, filterSlashCommands } from "./component/slash-palette"
import { write as clipboardWrite } from "./clipboard"
import type { EventSource } from "./context/sdk"
import type { Args } from "./context/args"
import type { TuiConfig } from "./config"
import { win32DisableProcessedInput, win32FlushInputBuffer } from "./terminal-win32"
import { destroyRenderer } from "./util/renderer"
import { cliErrorMessage, errorFormat } from "./util/error"

registerLotusCodeSpinner()

// ─── Color palette ─────────────────────────────────────────────────────────────
const C_BG     = RGBA.fromHex("#F5F1E8")  // paper cream bg
const C_EGG    = RGBA.fromHex("#1A1A1A")  // near-black — assistant text
const C_WHITE  = RGBA.fromHex("#000000")  // pure black — user text
const C_DIM    = RGBA.fromHex("#6B5D45")  // warm brown-gray — tool/muted text
const C_MUTED  = RGBA.fromHex("#C8B896")  // warm border/divider
const C_INPUT  = RGBA.fromHex("#EEE7D5")  // slightly darker cream — input bg
const C_ACCENT = RGBA.fromHex("#8B7355")  // warm brown — running indicator
const C_USER_BG = RGBA.fromHex("#DBCFB0")  // warm tan — user message bubble

// Minimal empty syntax style — the <markdown> element needs one but we don't
// need code-syntax highlighting inside assistant prose.
const EMPTY_SYNTAX = SyntaxStyle.fromTheme([])

// ─── Whimsical spinner words ───────────────────────────────────────────────────
const SPINNER_WORDS = [
  "Pondering",
  "Percolating",
  "Ruminating",
  "Contemplating",
  "Concocting",
  "Marinating",
  "Simmering",
  "Noodling",
  "Scheming",
  "Brewing",
  "Divining",
  "Puzzling",
  "Untangling",
  "Wrangling",
  "Chiseling",
  "Sculpting",
  "Distilling",
  "Whittling",
  "Manifesting",
  "Deliberating",
  "Synthesizing",
  "Rummaging",
  "Weaving",
  "Tinkering",
  "Cogitating",
  "Musing",
  "Coalescing",
  "Hatching",
  "Conjuring",
  "Herding",
]

const pickSpinnerWord = () => SPINNER_WORDS[Math.floor(Math.random() * SPINNER_WORDS.length)]!

// ─── Shine gradient helpers ────────────────────────────────────────────────────
type Rgb = { r: number; g: number; b: number }

const parseHex = (hex: string): Rgb => {
  const h = hex.replace("#", "")
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  }
}

const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")

const blendHex = (a: Rgb, b: Rgb, t: number) =>
  `#${toHex(a.r + (b.r - a.r) * t)}${toHex(a.g + (b.g - a.g) * t)}${toHex(a.b + (b.b - a.b) * t)}`

const SHINE_BASE = parseHex("#B8A47C")   // muted warm — most of the word
const SHINE_PEAK = parseHex("#1A1A1A")   // near-black — the highlight
const SHINE_SIGMA = 1.5                  // width of the highlight in chars

const shineColorFor = (charIndex: number, position: number) => {
  const distance = charIndex - position
  const t = Math.exp(-(distance * distance) / (2 * SHINE_SIGMA * SHINE_SIGMA))
  return blendHex(SHINE_BASE, SHINE_PEAK, t)
}

export type TuiInput = {
  url: string
  args: Args
  config: TuiConfig.Resolved
  onSnapshot?: () => Promise<string[]>
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  events?: EventSource
}

export const run = Effect.fn("Tui.run")(function* (input: TuiInput) {
  const exit = { epilogue: undefined as string | undefined, reason: undefined as unknown }
  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      const renderer = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            createCliRenderer({
              externalOutputMode: "passthrough",
              targetFps: 60,
              gatherStats: false,
              exitOnCtrlC: false,
              useKittyKeyboard: {},
              autoFocus: false,
              openConsoleOnError: false,
              useMouse: !Flag.LOTUS_DISABLE_MOUSE && input.config.mouse,
              consoleOptions: {
                keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
              },
            }),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
        (renderer) =>
          Effect.sync(() => {
            destroyRenderer(renderer)
          }),
      )
      win32DisableProcessedInput()
      const keymap = createDefaultOpenTuiKeymap(renderer)
      yield* Effect.acquireRelease(
        Effect.sync(() => registerLotusCodeKeymap(keymap, renderer, input.config)),
        (unregister) => Effect.sync(unregister),
      )
      const shutdown = yield* Deferred.make<unknown>()
      const onSighup = () => destroyRenderer(renderer)
      yield* Effect.acquireRelease(
        Effect.sync(() => process.on("SIGHUP", onSighup)),
        () => Effect.sync(() => process.off("SIGHUP", onSighup)),
      )
      renderer.once("destroy", () => Deferred.doneUnsafe(shutdown, Effect.void))

      yield* Effect.tryPromise(async () => {
        void renderer.getPalette({ size: 16 }).catch(() => undefined)
        const mode = (await renderer.waitForThemeMode(1000)) ?? "dark"
        if (renderer.isDestroyed) return

        await render(() => {
          return (
            <ExitProvider
              exit={(reason) => {
                if (renderer.isDestroyed) return
                exit.reason = reason
                destroyRenderer(renderer)
              }}
            >
              <EpilogueProvider set={(value) => (exit.epilogue = value)}>
                <ErrorBoundary fallback={(error, reset) => <ErrorComponent error={error} reset={reset} mode={mode} />}>
                  <SDKProvider
                    url={input.url}
                    directory={input.directory}
                    fetch={input.fetch}
                    headers={input.headers}
                    events={input.events}
                  >
                    <Chat />
                  </SDKProvider>
                </ErrorBoundary>
              </EpilogueProvider>
            </ExitProvider>
          )
        }, renderer)
      })
      yield* Deferred.await(shutdown)
      return { epilogue: exit.epilogue, reason: exit.reason }
    }),
  )
  yield* Effect.sync(() => {
    win32FlushInputBuffer()
    if (result.reason !== undefined)
      process.stderr.write((cliErrorMessage(result.reason) ?? errorFormat(result.reason)) + "\n")
    if (result.epilogue) process.stdout.write(result.epilogue + "\n")
  })
})

// ─── Types ─────────────────────────────────────────────────────────────────────

type ChatPart = {
  id: string
  messageID: string
  type: "text" | "tool" | "reasoning"
  text?: string
  tool?: string
  callID?: string
  state?: {
    status: "running" | "completed" | "error"
    input?: any
    output?: string
    error?: string
    metadata?: any
  }
}

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  agent?: string
}

type SubagentState = "running" | "completed" | "error"

type SubagentTranscript = {
  childSid: string
  subagentType: string
  description?: string
  state: SubagentState
  msgOrder: string[]
  msgs: Record<string, ChatMessage>
  partOrder: Record<string, string[]>
  parts: Record<string, ChatPart>
}

// ─── NestedSubagentTranscript ──────────────────────────────────────────────────
// Shows the child session's activity nested under the spawning task/agent tool
// row. Only assistant parts are rendered — the initial user prompt is the tool
// input, so showing it again would be redundant. Collapsible via chevron.
function NestedSubagentTranscript(props: {
  transcript: SubagentTranscript
  agentColor: (name: string) => RGBA
}) {
  // Collapsed by default — expand on click to watch or inspect activity.
  const [collapsed, setCollapsed] = createSignal(true)

  const chevron = () => (collapsed() ? "▶" : "▼")
  const stateGlyph = () =>
    props.transcript.state === "running"
      ? "…"
      : props.transcript.state === "error"
        ? "✗"
        : "✓"

  const msgs = () =>
    props.transcript.msgOrder
      .map((id) => props.transcript.msgs[id])
      .filter((m) => m && m.role === "assistant")

  return (
    <box gap={0} marginTop={1} paddingLeft={2}>
      <box onMouseUp={() => setCollapsed((c) => !c)}>
        <text
          fg={props.agentColor(props.transcript.subagentType)}
          attributes={TextAttributes.BOLD}
        >
          {chevron()} ▎ {props.transcript.subagentType} {stateGlyph()}
        </text>
      </box>
      <Show when={!collapsed()}>
        <box paddingLeft={2}>
          <For each={msgs()}>
            {(msg) => {
              const parts = () =>
                (props.transcript.partOrder[msg!.id] ?? [])
                  .map((k) => props.transcript.parts[k])
                  .filter(Boolean) as ChatPart[]
              return (
                <For each={parts()}>
                  {(part) => (
                    <Switch>
                      <Match when={part.type === "text" && part.text?.trim()}>
                        <text fg={C_EGG} wrapMode="word">
                          {part.text!.trim()}
                        </text>
                      </Match>
                      <Match when={part.type === "tool"}>
                        {/* Nested tool rows render without their own subagent
                            lookup — one level of nesting is enough. */}
                        <ToolRow part={part} />
                      </Match>
                    </Switch>
                  )}
                </For>
              )
            }}
          </For>
        </box>
      </Show>
    </box>
  )
}

// ─── ToolRow ───────────────────────────────────────────────────────────────────

function ToolRow(props: {
  part: ChatPart
  lookupSubagent?: (callID: string) => SubagentTranscript | undefined
  agentColor?: (name: string) => RGBA
}) {
  const [collapsed, setCollapsed] = createSignal(true)
  const status = () => props.part.state?.status ?? "running"
  const name = () => props.part.tool ?? "tool"
  const inputStr = () => {
    const inp = props.part.state?.input
    if (!inp) return ""
    // For agent/task delegation tools, the raw JSON is noise — surface the
    // human-readable description and subagent_type instead.
    if ((name() === "agent" || name() === "task") && typeof inp === "object") {
      const rec = inp as { description?: string; subagent_type?: string }
      const sub = rec.subagent_type ? `(${rec.subagent_type}) ` : ""
      const desc = rec.description ?? ""
      const label = `${sub}${desc}`.trim()
      return label || "spawning subagent"
    }
    const s = typeof inp === "string" ? inp : JSON.stringify(inp)
    return s.length > 60 ? s.slice(0, 60) + "…" : s
  }
  const output = () => {
    const o = props.part.state?.output?.trim() ?? ""
    return o.length > 3000 ? o.slice(0, 3000) + "\n…" : o
  }
  const icon = () => (status() === "running" ? "~" : status() === "error" ? "✗" : "✓")
  const color = () => (status() === "error" ? RGBA.fromHex("#CC6666") : C_DIM)
  const hasOutput = () => output() && status() !== "running"
  const chevron = () => (hasOutput() ? (collapsed() ? "▶" : "▼") : " ")

  const subagent = () =>
    props.lookupSubagent && props.part.callID
      ? props.lookupSubagent(props.part.callID)
      : undefined

  return (
    <box gap={0} marginTop={1}>
      <box
        onMouseUp={() => {
          if (hasOutput()) setCollapsed((prev) => !prev)
        }}
      >
        <text fg={color()} wrapMode="word">
          {chevron()} {icon()} {name()} {inputStr()}
        </text>
      </box>
      <Show when={subagent() && props.agentColor}>
        <NestedSubagentTranscript
          transcript={subagent()!}
          agentColor={props.agentColor!}
        />
      </Show>
      <Show when={hasOutput() && !collapsed()}>
        <text fg={C_DIM} wrapMode="word" paddingLeft={2}>
          {output()}
        </text>
      </Show>
    </box>
  )
}

// ─── AssistantRow ──────────────────────────────────────────────────────────────

function AssistantRow(props: {
  parts: () => ChatPart[]
  agent?: string
  agentColor: (name: string) => RGBA
  lookupSubagent?: (callID: string) => SubagentTranscript | undefined
}) {
  return (
    <box paddingTop={1} paddingLeft={4} paddingRight={4} flexShrink={0} gap={0}>
      <Show when={props.agent}>
        {(name) => (
          <text fg={props.agentColor(name())} attributes={TextAttributes.BOLD} marginBottom={1}>
            {"▎ "}
            {name()}
          </text>
        )}
      </Show>
      <For each={props.parts()}>
        {(part) => (
          <Switch>
            <Match when={part.type === "text" && part.text?.trim()}>
              <markdown
                content={part.text!.trim()}
                streaming={true}
                syntaxStyle={EMPTY_SYNTAX}
                fg={C_EGG}
                bg={C_BG}
              />
            </Match>
            <Match when={part.type === "reasoning" && part.text?.trim()}>
              <text fg={C_DIM} wrapMode="word">
                [thinking] {part.text!.trim()}
              </text>
            </Match>
            <Match when={part.type === "tool"}>
              <ToolRow
                part={part}
                lookupSubagent={props.lookupSubagent}
                agentColor={props.agentColor}
              />
            </Match>
          </Switch>
        )}
      </For>
    </box>
  )
}

// ─── UserRow ───────────────────────────────────────────────────────────────────

function UserRow(props: { parts: () => ChatPart[] }) {
  const text = () =>
    props
      .parts()
      .filter((p) => p.type === "text" && p.text?.trim())
      .map((p) => p.text!)
      .join("\n")
  return (
    <Show when={text()}>
      <box paddingTop={1} paddingLeft={4} paddingRight={4} flexShrink={0}>
        <box
          backgroundColor={C_USER_BG}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
        >
          <text fg={C_WHITE} wrapMode="word">
            {text()}
          </text>
        </box>
      </box>
    </Show>
  )
}

// ─── MessageRow ────────────────────────────────────────────────────────────────

type StoreShape = {
  msgOrder: string[]
  msgs: Record<string, ChatMessage>
  partOrder: Record<string, string[]>
  parts: Record<string, ChatPart>
  // Subagent transcripts nested under the spawning tool call.
  subagents: Record<string /* toolCallID */, SubagentTranscript>
  subagentByChildSid: Record<string /* childSid */, string /* toolCallID */>
}

const partKey = (messageID: string, partID: string) => `${messageID}::${partID}`

function MessageRow(props: {
  msgID: string
  store: StoreShape
  agentColor: (name: string) => RGBA
  lookupSubagent: (callID: string) => SubagentTranscript | undefined
}) {
  const msg = () => props.store.msgs[props.msgID]
  const parts = () =>
    (props.store.partOrder[props.msgID] ?? []).map((key) => props.store.parts[key]).filter(Boolean)

  // Multi-step turns produce multiple assistant messages back-to-back — one
  // per LLM step. Only render the agent badge on the FIRST assistant message
  // of a run (i.e. when the previous message was a user, or a different agent).
  const shouldShowBadge = () => {
    const m = msg()
    if (!m || m.role !== "assistant") return false
    const idx = props.store.msgOrder.indexOf(props.msgID)
    if (idx <= 0) return true
    const prev = props.store.msgs[props.store.msgOrder[idx - 1]]
    if (!prev) return true
    if (prev.role !== "assistant") return true
    return prev.agent !== m.agent
  }

  return (
    <Show when={msg()}>
      {(m) => (
        <Show
          when={m().role === "user"}
          fallback={
            <AssistantRow
              parts={parts}
              agent={shouldShowBadge() ? m().agent : undefined}
              agentColor={props.agentColor}
              lookupSubagent={props.lookupSubagent}
            />
          }
        >
          <UserRow parts={parts} />
        </Show>
      )}
    </Show>
  )
}

// ─── Chat ──────────────────────────────────────────────────────────────────────

function Chat() {
  const sdk = useSDK()
  const exit = useExit()
  const renderer = useRenderer()

  const [sessionID, setSessionID] = createSignal<string | null>(null)
  const [running, setRunning] = createSignal(false)
  const [spinnerWord, setSpinnerWord] = createSignal(pickSpinnerWord())
  const [shinePos, setShinePos] = createSignal(0)

  // Cost / time / context tracking.
  // `lastAssistant` mirrors the freshest assistant AssistantMessage so we can
  // compute live token totals, context %, and cumulative cost — the base store
  // only keeps { id, role, agent } for rendering.
  const [lastAssistant, setLastAssistant] = createSignal<{
    id: string
    timeCreated: number
    providerID: string
    modelID: string
    cost: number
    tokens: {
      input: number
      output: number
      reasoning: number
      cache: { read: number; write: number }
    }
  }>()
  const [modelLimits, setModelLimits] = createSignal<Record<string, number>>({})
  const [turnStart, setTurnStart] = createSignal<number | undefined>(undefined)
  const [nowTs, setNowTs] = createSignal(Date.now())
  const [store, setStore] = createStore<StoreShape>({
    msgOrder: [],
    msgs: {},
    partOrder: {},
    parts: {},
    subagents: {},
    subagentByChildSid: {},
  })

  // ── Agents ──────────────────────────────────────────────────────────────
  // Fetched from /agent. Only "primary" (non-hidden, non-subagent) agents
  // participate in Tab cycling — hidden agents (compaction/title/summary)
  // fire internally, and subagents are invoked via TaskTool.
  type AgentEntry = { name: string; mode?: string; hidden?: boolean; color?: string }
  const [agents, setAgents] = createSignal<AgentEntry[]>([])
  const [agentIndex, setAgentIndex] = createSignal(0)
  const currentAgent = () => agents()[agentIndex()]
  const currentAgentName = () => currentAgent()?.name ?? "build"

  // Distinct, warm-paper-friendly colors that pop against C_BG (#F5F1E8).
  // Known agents get curated colors; anything else falls back through the
  // palette by index. Kept saturated enough to read as a "chip" but not
  // neon — this UI is intentionally soft.
  const AGENT_COLORS: Record<string, string> = {
    build:   "#2E7D6E",   // deep sea-glass green — confident, "doing work"
    plan:    "#C05F3F",   // persimmon — advisory, cautious
    explore: "#3D6FB8",   // cobalt blue — cool, searching, spelunking
    general: "#7D5A9B",   // plum-violet — versatile, generalist
  }
  const AGENT_PALETTE = ["#2E7D6E", "#C05F3F", "#3D6FB8", "#7D5A9B", "#B5843A"]
  const agentColor = (name: string) => {
    if (AGENT_COLORS[name]) return RGBA.fromHex(AGENT_COLORS[name])
    const idx = agents().findIndex((a) => a.name === name)
    const hex = AGENT_PALETTE[(idx >= 0 ? idx : 0) % AGENT_PALETTE.length]
    return RGBA.fromHex(hex)
  }

  onMount(async () => {
    const res = await sdk.client.app.agents({}).catch(() => null)
    const list = (res?.data ?? []) as AgentEntry[]
    if (!Array.isArray(list) || list.length === 0) return
    const primary = list.filter((a) => !a.hidden && a.mode !== "subagent")
    if (primary.length === 0) return
    setAgents(primary)
    const buildIdx = primary.findIndex((a) => a.name === "build")
    setAgentIndex(buildIdx >= 0 ? buildIdx : 0)
  })

  // Model context-limit lookup, keyed as "providerID/modelID".
  onMount(async () => {
    try {
      const res = await sdk.client.provider.list({} as any).catch(() => null)
      const data = res?.data as
        | {
            providers?: Array<{
              id: string
              models: Record<string, { limit?: { context?: number } }>
            }>
          }
        | undefined
      const providers = data?.providers ?? []
      const map: Record<string, number> = {}
      for (const p of providers) {
        for (const [mid, m] of Object.entries(p.models ?? {})) {
          const c = m?.limit?.context
          if (typeof c === "number" && c > 0) map[`${p.id}/${mid}`] = c
        }
      }
      setModelLimits(map)
    } catch {
      // Provider list is best-effort; context % just won't show a percentage.
    }
  })

  // Turn timer: stamp on every idle→busy transition, but leave `turnStart`
  // pinned once the turn ends so the "3s · 245 tok" line stays visible next to
  // where the spinner was until the next turn overwrites it.
  createEffect(() => {
    if (running()) {
      setTurnStart(Date.now())
      setNowTs(Date.now())
    }
  })

  // Only tick while the model is running — when it finishes, `nowTs` freezes,
  // which freezes `elapsedSecs` at the final duration.
  createEffect(() => {
    if (!running()) return
    const timer = setInterval(() => setNowTs(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    if (!running()) return
    setSpinnerWord(pickSpinnerWord())
    const wordTimer = setInterval(() => setSpinnerWord(pickSpinnerWord()), 2500)
    onCleanup(() => clearInterval(wordTimer))
  })

  const elapsedSecs = () => {
    const start = turnStart()
    if (start === undefined) return 0
    return Math.max(0, Math.floor((nowTs() - start) / 1000))
  }

  // Output tokens for the current turn only — filter by whether the last
  // AssistantMessage was created after this turn started (small backdate for
  // clock skew between server and client).
  const liveOutputTokens = () => {
    const start = turnStart()
    const last = lastAssistant()
    if (start === undefined || !last) return 0
    if (last.timeCreated < start - 1000) return 0
    return last.tokens.output
  }

  const streamingStats = () => {
    const parts: string[] = []
    const secs = elapsedSecs()
    if (secs > 0) parts.push(`${secs}s`)
    const t = liveOutputTokens()
    if (t > 0) parts.push(`${t.toLocaleString()} tok`)
    return parts.join(" · ")
  }

  const contextUsage = () => {
    const last = lastAssistant()
    if (!last) return undefined
    const tot =
      last.tokens.input +
      last.tokens.output +
      last.tokens.reasoning +
      last.tokens.cache.read +
      last.tokens.cache.write
    if (tot <= 0) return undefined
    const limit = modelLimits()[`${last.providerID}/${last.modelID}`]
    if (!limit) return `${tot.toLocaleString()} tok`
    return `${Math.round((tot / limit) * 100)}% (${tot.toLocaleString()})`
  }

  createEffect(() => {
    if (!running()) return
    setShinePos(-3)
    const shineTimer = setInterval(() => {
      setShinePos((prev) => {
        const len = spinnerWord().length + 4
        const next = prev + 0.5
        return next > len ? -3 : next
      })
    }, 60)
    onCleanup(() => clearInterval(shineTimer))
  })

  let inputEl: TextareaRenderable | undefined
  let scrollEl: any

  const [paletteOpen, setPaletteOpen] = createSignal(false)
  const [paletteQuery, setPaletteQuery] = createSignal("")
  const [paletteIndex, setPaletteIndex] = createSignal(0)
  const [paletteScrollTop, setPaletteScrollTop] = createSignal(0)
  const paletteMatches = () => filterSlashCommands(paletteQuery())

  // Keep the selected item inside the viewport window.
  function reconcileScroll(nextIndex: number, matchCount: number) {
    const maxTop = Math.max(0, matchCount - PALETTE_VIEWPORT)
    setPaletteScrollTop((top) => {
      let next = Math.min(top, maxTop)
      if (nextIndex < next) next = nextIndex
      else if (nextIndex >= next + PALETTE_VIEWPORT) next = nextIndex - PALETTE_VIEWPORT + 1
      return Math.max(0, Math.min(next, maxTop))
    })
  }

  function moveSelection(delta: number) {
    const matches = paletteMatches()
    if (matches.length === 0) return
    const nextIndex = (() => {
      const raw = paletteIndex() + delta
      if (raw < 0) return matches.length - 1
      if (raw >= matches.length) return 0
      return raw
    })()
    setPaletteIndex(nextIndex)
    reconcileScroll(nextIndex, matches.length)
  }

  function updatePaletteFromInput() {
    const text = inputEl?.plainText ?? ""
    if (text.startsWith("/") && !text.includes(" ") && !text.includes("\n")) {
      setPaletteQuery(text.slice(1))
      setPaletteOpen(true)
      const matches = paletteMatches()
      const max = Math.max(0, matches.length - 1)
      const clamped = Math.min(paletteIndex(), max)
      setPaletteIndex(clamped)
      reconcileScroll(clamped, matches.length)
    } else if (paletteOpen()) {
      setPaletteOpen(false)
      setPaletteIndex(0)
      setPaletteScrollTop(0)
    }
  }

  function closePalette() {
    setPaletteOpen(false)
    setPaletteIndex(0)
    setPaletteScrollTop(0)
  }

  // Tab completion: insert `/name ` into input so the user can add args.
  function completeSlashCommand() {
    const match = paletteMatches()[paletteIndex()]
    if (!match) return
    inputEl?.setText("/" + match.name + " ")
    closePalette()
  }

  // ── Command status banner ───────────────────────────────────────────────
  const [status, setStatus] = createSignal<{ text: string; kind: "info" | "warn" | "error" } | undefined>()
  let statusTimer: ReturnType<typeof setTimeout> | undefined
  function showStatus(text: string, kind: "info" | "warn" | "error" = "info") {
    setStatus({ text, kind })
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = setTimeout(() => setStatus(undefined), 3000)
  }
  onCleanup(() => statusTimer && clearTimeout(statusTimer))

  async function cycleAgent() {
    const list = agents()
    if (list.length === 0) return
    const next = (agentIndex() + 1) % list.length
    setAgentIndex(next)
    // If a session already exists, persist the switch so the next turn uses
    // the new agent's system prompt + permission ruleset.
    const sid = sessionID()
    if (sid) {
      await sdk.client.session.update({ sessionID: sid, agent: list[next].name }).catch(() => {})
    }
  }

  function buildTranscript(): string {
    const lines: string[] = []
    for (const msgID of store.msgOrder) {
      const msg = store.msgs[msgID]
      if (!msg) continue
      lines.push(`## ${msg.role}`)
      const parts = (store.partOrder[msgID] ?? []).map((k) => store.parts[k]).filter(Boolean) as ChatPart[]
      for (const part of parts) {
        if (part.type === "text" && part.text) lines.push(part.text)
        else if (part.type === "reasoning" && part.text) lines.push(`[thinking] ${part.text}`)
        else if (part.type === "tool") {
          const inp = part.state?.input
          const io = inp ? (typeof inp === "string" ? inp : JSON.stringify(inp)) : ""
          lines.push(`[tool ${part.tool ?? ""}] ${io}`.trim())
          if (part.state?.output) lines.push(part.state.output)
        }
      }
      lines.push("")
    }
    return lines.join("\n").trim()
  }

  async function ensureSessionID(): Promise<string | null> {
    const existing = sessionID()
    if (existing) return existing
    const res = await sdk.client.session
      .create({
        agent: currentAgentName(),
        model: { providerID: "deepseek", id: "deepseek-chat" },
      })
      .catch(() => null)
    const sid = res?.data?.id
    if (!sid) return null
    setSessionID(sid)
    return sid
  }

  // Actual command execution — called from palette Enter, and as a two-step
  // parse in submit() for commands that take args (e.g. /rename <title>).
  async function runSlashCommand(name: string) {
    switch (name) {
      case "copy": {
        const transcript = buildTranscript()
        if (!transcript) {
          showStatus("Nothing to copy yet", "warn")
          return
        }
        await clipboardWrite(transcript)
        showStatus("Copied transcript to clipboard")
        return
      }
      case "compact": {
        const sid = sessionID()
        if (!sid) {
          showStatus("Start a session first", "warn")
          return
        }
        await sdk.client.session
          .summarize({ sessionID: sid, modelID: "deepseek-chat", providerID: "deepseek" })
          .catch(() => {})
        showStatus("Summarizing session…")
        return
      }
      case "undo": {
        const sid = sessionID()
        if (!sid) {
          showStatus("Nothing to undo", "warn")
          return
        }
        const lastUser = [...store.msgOrder].reverse().find((id) => store.msgs[id]?.role === "user")
        if (!lastUser) {
          showStatus("No user message to undo", "warn")
          return
        }
        await sdk.client.session.revert.stage({ sessionID: sid, messageID: lastUser }).catch(() => {})
        showStatus("Reverted last user message")
        return
      }
      case "redo": {
        const sid = sessionID()
        if (!sid) {
          showStatus("Nothing to redo", "warn")
          return
        }
        await sdk.client.session.unrevert({ sessionID: sid }).catch(() => {})
        showStatus("Restored reverted messages")
        return
      }
      case "rename": {
        // Two-step: insert prefix; user types title; submit() will finish it.
        inputEl?.setText("/rename ")
        showStatus("Type a new title then press Enter")
        return
      }
      default:
        showStatus(`/${name} isn't wired up in this UI yet`, "warn")
    }
  }

  // Intercept up/down/tab/escape BEFORE the global keymap eats them for cursor
  // movement. Prepending on `keyInput` ensures we fire before the keymap
  // (which itself prepends). Steals keys for palette navigation while the
  // palette is open, and for agent cycling (tab/shift+tab) while it is closed.
  onMount(() => {
    const listener = (key: KeyEvent) => {
      // Palette closed: tab cycles the active agent forward.
      if (!paletteOpen()) {
        if (key.name === "tab" && !key.shift) {
          void cycleAgent()
          key.preventDefault()
        }
        return
      }
      const matches = paletteMatches()
      if (key.name === "escape") {
        setPaletteOpen(false)
        setPaletteIndex(0)
        setPaletteScrollTop(0)
        key.preventDefault()
        return
      }
      if (matches.length === 0) return
      if (key.name === "up") {
        moveSelection(-1)
        key.preventDefault()
        return
      }
      if (key.name === "down") {
        moveSelection(1)
        key.preventDefault()
        return
      }
      if (key.name === "tab") {
        completeSlashCommand()
        key.preventDefault()
        return
      }
      if (key.name === "return") {
        const match = matches[paletteIndex()]
        closePalette()
        if (match) {
          inputEl?.setText("")
          void runSlashCommand(match.name)
        }
        key.preventDefault()
        return
      }
    }
    renderer.keyInput.prependListener("keypress", listener)
    onCleanup(() => renderer.keyInput.off("keypress", listener))
  })

  onMount(() => {
    const off = sdk.event.on("event", (rawEvent) => {
      // The SDK's Event union doesn't yet declare our custom subagent lifecycle
      // events, so widen once here for the discriminant checks below.
      const payload = rawEvent.payload as
        | typeof rawEvent.payload
        | { type: "session.subagent.spawned"; properties: Record<string, unknown> }
        | { type: "session.subagent.ended"; properties: Record<string, unknown> }

      // Subagent lifecycle — register/finalize a nested transcript keyed by
      // the spawning tool call so ToolRow can render it inline.
      if (payload.type === "session.subagent.spawned") {
        const props = payload.properties as {
          childSessionID?: string
          subagentType?: string
          toolCallID?: string
          description?: string
        }
        const tcid = props.toolCallID
        const csid = props.childSessionID
        if (!tcid || !csid) return
        if (!store.subagents[tcid]) {
          setStore("subagents", tcid, {
            childSid: csid,
            subagentType: props.subagentType ?? "subagent",
            description: props.description,
            state: "running",
            msgOrder: [],
            msgs: {},
            partOrder: {},
            parts: {},
          })
        }
        setStore("subagentByChildSid", csid, tcid)
        return
      }
      if (payload.type === "session.subagent.ended") {
        const props = payload.properties as {
          toolCallID?: string
          state?: SubagentState
        }
        const tcid = props.toolCallID
        if (!tcid || !store.subagents[tcid]) return
        setStore("subagents", tcid, "state", (props.state ?? "completed") as SubagentState)
        return
      }

      if (payload.type === "message.updated") {
        const msg = payload.properties.info
        const msgSid = (msg as { sessionID?: string }).sessionID
        const currentSid = sessionID()

        // Route into nested subagent transcript if the message belongs to a
        // known child session. Otherwise, unrelated-session events are ignored.
        if (msgSid && msgSid !== currentSid) {
          const tcid = store.subagentByChildSid[msgSid]
          if (!tcid) return
          if (!store.subagents[tcid]?.msgOrder.includes(msg.id)) {
            setStore("subagents", tcid, "msgOrder", (prev) => [...(prev ?? []), msg.id])
          }
          setStore("subagents", tcid, "msgs", msg.id, {
            id: msg.id,
            role: msg.role as "user" | "assistant",
            agent: (msg as { agent?: string }).agent,
          })
          return
        }

        if (!store.msgOrder.includes(msg.id)) {
          setStore("msgOrder", (prev) => [...prev, msg.id])
        }
        setStore("msgs", msg.id, {
          id: msg.id,
          role: msg.role as "user" | "assistant",
          agent: (msg as { agent?: string }).agent,
        })

        if (msg.role === "assistant") {
          const a = msg as {
            id: string
            providerID: string
            modelID: string
            cost?: number
            time: { created: number }
            tokens: {
              input: number
              output: number
              reasoning: number
              cache: { read: number; write: number }
            }
          }
          setLastAssistant({
            id: a.id,
            timeCreated: a.time.created,
            providerID: a.providerID,
            modelID: a.modelID,
            cost: a.cost ?? 0,
            tokens: a.tokens,
          })
        }
      } else if (payload.type === "message.part.updated") {
        const part = payload.properties.part
        // Only handle text, reasoning, and tool parts
        if (part.type !== "text" && part.type !== "reasoning" && part.type !== "tool") return

        const chatPart: ChatPart = (() => {
          if (part.type === "text") {
            return {
              id: part.id,
              messageID: part.messageID,
              type: "text" as const,
              text: part.text,
            }
          }
          if (part.type === "reasoning") {
            return {
              id: part.id,
              messageID: part.messageID,
              type: "reasoning" as const,
              text: part.text,
            }
          }
          // tool
          const toolPart = part as Extract<typeof part, { type: "tool" }>
          const state = toolPart.state
          let mappedState: ChatPart["state"]
          if (state.status === "running") {
            mappedState = {
              status: "running",
              input: state.input,
              metadata: state.metadata,
            }
          } else if (state.status === "completed") {
            mappedState = {
              status: "completed",
              input: state.input,
              output: state.output,
              metadata: state.metadata,
            }
          } else if (state.status === "error") {
            mappedState = {
              status: "error",
              input: state.input,
              error: state.error,
              metadata: state.metadata,
            }
          } else {
            // pending
            mappedState = { status: "running" }
          }
          return {
            id: part.id,
            messageID: part.messageID,
            type: "tool" as const,
            tool: toolPart.tool,
            callID: toolPart.callID,
            state: mappedState,
          }
        })()

        // Route part into nested transcript if it belongs to a subagent's session
        const partSid = (part as { sessionID?: string }).sessionID
        const currentSid = sessionID()
        if (partSid && partSid !== currentSid) {
          const tcid = store.subagentByChildSid[partSid]
          if (!tcid) return
          const key = partKey(part.messageID, part.id)
          setStore("subagents", tcid, "parts", key, chatPart)
          if (!store.subagents[tcid]?.partOrder[part.messageID]?.includes(key)) {
            setStore(
              "subagents",
              tcid,
              "partOrder",
              part.messageID,
              (prev) => [...(prev ?? []), key],
            )
          }
          scrollEl?.scrollTo?.(scrollEl?.scrollHeight ?? 0)
          return
        }

        const key = partKey(part.messageID, part.id)
        setStore("parts", key, chatPart)
        if (!store.partOrder[part.messageID]?.includes(key)) {
          setStore("partOrder", part.messageID, (prev) => [...(prev ?? []), key])
        }
        scrollEl?.scrollTo?.(scrollEl?.scrollHeight ?? 0)
      } else if (payload.type === "session.status") {
        const statusType = payload.properties.status.type
        // "idle" means not running; "busy" or "retry" means active
        setRunning(statusType !== "idle")
      }
    })
    onCleanup(off)
  })

  async function submit() {
    const text = inputEl?.plainText?.trim() ?? ""
    if (!text || running()) return

    // Two-step commands: intercept `/rename <title>` and other arg-taking
    // slash commands here. Bare `/name` with no args also routes back to the
    // handler so users can type the command by hand.
    if (text.startsWith("/")) {
      const [head, ...rest] = text.split(/\s+/)
      const name = head.slice(1)
      const arg = rest.join(" ").trim()
      if (name === "rename") {
        if (!arg) {
          showStatus("Type a new title after /rename", "warn")
          return
        }
        const sid = await ensureSessionID()
        if (!sid) {
          showStatus("Failed to create session", "error")
          return
        }
        inputEl?.setText("")
        await sdk.client.session.update({ sessionID: sid, title: arg }).catch(() => {})
        showStatus(`Renamed session to "${arg}"`)
        return
      }
      // Any known slash command typed by hand with no args → run its handler.
      if (!arg && filterSlashCommands(name).some((c) => c.name === name || c.aliases?.includes(name))) {
        inputEl?.setText("")
        void runSlashCommand(name)
        return
      }
    }

    inputEl?.setText("")
    const sid = await ensureSessionID()
    if (!sid) return
    await sdk.client.session
      .prompt({
        sessionID: sid,
        parts: [{ type: "text", text }],
      })
      .catch(() => {})
  }

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={C_BG}>
      {/* Messages */}
      <scrollbox
        ref={(r: any) => (scrollEl = r)}
        flexGrow={1}
        stickyScroll
        stickyStart="bottom"
        paddingBottom={1}
        verticalScrollbarOptions={{ visible: false }}
      >
        <box height={1} />
        <For each={store.msgOrder}>
          {(msgID) => (
            <MessageRow
              msgID={msgID}
              store={store}
              agentColor={agentColor}
              lookupSubagent={(callID) => store.subagents[callID]}
            />
          )}
        </For>
        <Show when={running() || streamingStats()}>
          <box paddingLeft={4} paddingTop={1} flexShrink={0} flexDirection="row" gap={2}>
            <Show when={running()}>
              <text>
                {/* Index (not For) — chars in the word repeat (e.g. two "c"s in
                    "Concocting"), and For's referential-keying gets confused when
                    primitive items collide, leaving stale nodes from the prior
                    word bleeding into the new one. */}
                <Index each={(spinnerWord() + "…").split("")}>
                  {(ch, i) => <span style={{ fg: shineColorFor(i, shinePos()) }}>{ch()}</span>}
                </Index>
              </text>
            </Show>
            <Show when={streamingStats()}>
              <text fg={C_DIM}>{streamingStats()}</text>
            </Show>
          </box>
        </Show>
      </scrollbox>

      {/* Divider */}
      <box height={1} backgroundColor={C_MUTED} />

      {/* Command status banner */}
      <Show when={status()}>
        {(s) => (
          <box paddingLeft={2} paddingRight={2} backgroundColor={C_INPUT}>
            <text
              fg={s().kind === "error" ? RGBA.fromHex("#CC6666") : s().kind === "warn" ? C_ACCENT : C_DIM}
            >
              {s().text}
            </text>
          </box>
        )}
      </Show>

      {/* Slash command palette (appears when input starts with "/") */}
      <SlashPalette
        visible={paletteOpen}
        commands={paletteMatches}
        selected={paletteIndex}
        scrollTop={paletteScrollTop}
      />

      {/* Input */}
      <box
        flexShrink={0}
        flexDirection="row"
        alignItems="flex-start"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={C_INPUT}
      >
        <text fg={agentColor(currentAgentName())} attributes={TextAttributes.BOLD}>
          {"❯ "}
        </text>
        <textarea
          ref={(el: TextareaRenderable) => {
            inputEl = el
            el?.focus()
          }}
          flexGrow={1}
          textColor={C_EGG}
          backgroundColor={C_INPUT}
          cursorColor={agentColor(currentAgentName())}
          maxHeight={8}
          onContentChange={() => updatePaletteFromInput()}
          onSubmit={() => {
            if (paletteOpen() && paletteMatches().length > 0) {
              completeSlashCommand()
              return
            }
            void submit()
          }}
          onKeyDown={(e: KeyEvent) => {
            if (e.name === "c" && e.ctrl) {
              exit(new Error("interrupted"))
              return
            }
          }}
        />
      </box>

      {/* Agent footer — shows current agent, tab hint, and turn/context stats */}
      <Show when={agents().length > 0}>
        <box
          flexShrink={0}
          flexDirection="row"
          justifyContent="space-between"
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={C_BG}
        >
          <box flexDirection="row">
            <text fg={agentColor(currentAgentName())} attributes={TextAttributes.BOLD}>
              {"▎ "}
              {currentAgentName()}
            </text>
            <text fg={C_DIM}>
              {"   "}
              {agents().length > 1 ? "tab · next agent" : ""}
            </text>
          </box>
          <Show when={contextUsage()}>
            <text fg={C_DIM}>{contextUsage()}</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}
