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
import { AgentPalette, type AgentPaletteItem, type AgentPalettePhase } from "./component/agent-palette"
import { MentionPalette, MENTION_VIEWPORT } from "./component/mention-palette"
import { McpPalette, type McpPaletteItem, type McpPalettePhase } from "./component/mcp-palette"
import { ThemePalette, type ThemePaletteItem, type ThemeName } from "./component/theme-palette"
import { lotusArt } from "./logo"
import * as fs from "node:fs"
import * as os from "node:os"
import * as pathMod from "node:path"
import { write as clipboardWrite } from "./clipboard"
import type { EventSource } from "./context/sdk"
import type { Args } from "./context/args"
import type { TuiConfig } from "./config"
import { win32DisableProcessedInput, win32FlushInputBuffer } from "./terminal-win32"
import { destroyRenderer } from "./util/renderer"
import { cliErrorMessage, errorFormat } from "./util/error"

registerLotusCodeSpinner()

// ─── Theme system ──────────────────────────────────────────────────────────────
// Palette resolves at module load from the global config file. Changing the
// theme via /theme rewrites this config; the TUI must be restarted for a
// new palette to apply.

const GLOBAL_CONFIG_PATH = pathMod.join(os.homedir(), ".lotus-code", "config.json")

type Palette = {
  bg: string
  egg: string     // primary text
  white: string   // strongest text (user messages)
  dim: string     // muted / tool text
  muted: string   // borders & divider band
  input: string   // input textarea bg
  accent: string  // running indicator, palette headers
  userBg: string  // user message bubble bg
}

const LIGHT_PALETTE: Palette = {
  bg:     "#F5F1E8",  // paper cream
  egg:    "#1A1A1A",  // near-black
  white:  "#000000",
  dim:    "#6B5D45",  // warm brown-gray
  muted:  "#C8B896",  // warm border/divider
  input:  "#EEE7D5",
  accent: "#8B7355",
  userBg: "#DBCFB0",
}

const DARK_PALETTE: Palette = {
  bg:     "#222222",  // neutral dark
  egg:    "#E5D9BE",  // beige body text
  white:  "#F5EFDC",  // brighter beige for user text
  dim:    "#8F8577",  // muted beige-gray
  muted:  "#3A3835",  // neutral border/divider
  input:  "#2D2D2D",  // slightly lifted from bg
  accent: "#C8B896",  // warm light accent
  userBg: "#333330",  // subtle warm-tinted bubble
}

function readGlobalConfig(): { theme?: ThemeName } {
  try {
    const raw = fs.readFileSync(GLOBAL_CONFIG_PATH, "utf8")
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

const ACTIVE_THEME: ThemeName = readGlobalConfig().theme === "dark" ? "dark" : "light"
const PALETTE: Palette = ACTIVE_THEME === "dark" ? DARK_PALETTE : LIGHT_PALETTE

// ─── Color palette (derived from ACTIVE_THEME) ─────────────────────────────────
const C_BG      = RGBA.fromHex(PALETTE.bg)
const C_EGG     = RGBA.fromHex(PALETTE.egg)
const C_WHITE   = RGBA.fromHex(PALETTE.white)
const C_DIM     = RGBA.fromHex(PALETTE.dim)
const C_MUTED   = RGBA.fromHex(PALETTE.muted)
const C_INPUT   = RGBA.fromHex(PALETTE.input)
const C_ACCENT  = RGBA.fromHex(PALETTE.accent)
const C_USER_BG = RGBA.fromHex(PALETTE.userBg)

// Minimal empty syntax style — the <markdown> element needs one but we don't
// need code-syntax highlighting inside assistant prose.
const EMPTY_SYNTAX = SyntaxStyle.fromTheme([])

// Styled syntax used only by the input textarea, so that @-mentions get
// highlighted (bold + accent color) inline as the user types or completes.
const INPUT_SYNTAX = SyntaxStyle.fromStyles({
  mention: { fg: "#2E7D6E", bold: true },   // deep sea-glass green — pops on cream
})
const MENTION_STYLE_ID = INPUT_SYNTAX.getStyleId("mention") ?? 0
const MENTION_FG = RGBA.fromHex("#2E7D6E")

// Split `text` into alternating plain/mention segments so message rendering
// can bold-and-color `@path/to/file` tokens without losing surrounding text.
function splitMentions(text: string): Array<{ text: string; mention: boolean }> {
  const re = /(^|\s)(@\S+)/g
  const out: Array<{ text: string; mention: boolean }> = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const preLen = match[1]?.length ?? 0
    const start = match.index + preLen
    const end = start + (match[0].length - preLen)
    if (start > last) out.push({ text: text.slice(last, start), mention: false })
    out.push({ text: text.slice(start, end), mention: true })
    last = end
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false })
  return out.length > 0 ? out : [{ text, mention: false }]
}

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

// Circular / round glyphs for the tick-tock symbol beside the spinner word.
// Includes classic dot progression, half-filled circles, asterisks and floral
// stars — anything with rotational/circular form for a "weird but round" feel.
const SPINNER_SYMBOLS = [
  ".", "·", "∙", "•", "○", "●", "◉", "◎", "◍", "◌",
  "◐", "◑", "◒", "◓", "◔", "◕", "◖", "◗",
  "⊙", "⊚", "⊛", "⊜", "⊝",
  "⭘", "◯",
  "◆", "◇", "◈", "⚬",
  "✳", "✴", "✵", "✶", "✷", "✸", "✹", "✺",
  "❂", "❃", "❉", "❊", "❋",
  "❄", "❅", "❆", "❇", "❈",
  "✻", "✼", "✽", "✾", "✿", "❀", "❁",
  "⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷",
  "◴", "◵", "◶", "◷",
  "◜", "◝", "◞", "◟", "◠", "◡",
  "⚪", "☉", "☼", "❍",
]
const pickSpinnerSymbol = (): string =>
  SPINNER_SYMBOLS[Math.floor(Math.random() * SPINNER_SYMBOLS.length)]!

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

// Generic gaussian shine — used for the status message shimmer where the base
// and peak colors differ per message kind.
const shineBetween = (charIndex: number, position: number, base: Rgb, peak: Rgb, sigma = SHINE_SIGMA) => {
  const distance = charIndex - position
  const t = Math.exp(-(distance * distance) / (2 * sigma * sigma))
  return blendHex(base, peak, t)
}

const STATUS_PEAK = parseHex("#FFFFFF")   // white highlight — the sweep
const STATUS_BASE_INFO  = parseHex("#7A2E5C")
const STATUS_BASE_WARN  = parseHex("#C05F3F")
const STATUS_BASE_ERROR = parseHex("#B02828")

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
                          <For each={splitMentions(part.text!.trim())}>
                            {(seg) =>
                              seg.mention ? (
                                <span style={{ fg: MENTION_FG, attributes: TextAttributes.BOLD }}>{seg.text}</span>
                              ) : (
                                <span>{seg.text}</span>
                              )
                            }
                          </For>
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
            <For each={splitMentions(text())}>
              {(seg) =>
                seg.mention ? (
                  <b style={{ fg: MENTION_FG }}>{seg.text}</b>
                ) : (
                  <span>{seg.text}</span>
                )
              }
            </For>
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
  type AgentEntry = { name: string; description?: string; mode?: string; hidden?: boolean; color?: string }
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

  // ── Landing hero → chat transition ───────────────────────────────────────
  // When there are no messages yet, we show a centered landing screen with
  // the animated lotus ASCII + a "lotus" wordmark under the input. On the
  // user's first submit we run a ~500ms transition: the ASCII fades to
  // background, the centered wordmark fades out while a corner wordmark
  // fades in, and a flexGrow spacer under the input collapses so the input
  // settles at the bottom of the terminal.
  const [hasStartedChat, setHasStartedChat] = createSignal(false)
  const [transitionT, setTransitionT] = createSignal(0)  // 0 = fresh, 1 = chat
  createEffect(() => {
    if (!hasStartedChat()) return
    const start = performance.now()
    const duration = 500
    const raf = setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / duration)
      setTransitionT(t)
      if (t >= 1) clearInterval(raf)
    }, 32)
    onCleanup(() => clearInterval(raf))
  })

  // Lotus eye blinking — reuses the layout from component/logo.tsx: row 7
  // of the ASCII holds the eyes at char offsets 8-9 (left) + 14-15 (right).
  const LOTUS_EYE_ROW = 7
  const eyeLineChars = Array.from(lotusArt[LOTUS_EYE_ROW] ?? "")
  const EYE_PREFIX = eyeLineChars.slice(0, 8).join("")
  const LEFT_EYE_OPEN = eyeLineChars.slice(8, 10).join("")
  const EYE_MIDDLE = eyeLineChars.slice(10, 14).join("")
  const RIGHT_EYE_OPEN = eyeLineChars.slice(14, 16).join("")
  const EYE_SUFFIX = eyeLineChars.slice(16).join("")
  const LEFT_EYE_CLOSED = "⠒⠒"
  const RIGHT_EYE_CLOSED = "⠒⠒"
  const [eyesOpen, setEyesOpen] = createSignal(true)
  createEffect(() => {
    if (hasStartedChat()) return   // stop blinking once we've transitioned
    let closeTimer: ReturnType<typeof setTimeout>
    let openTimer: ReturnType<typeof setTimeout>
    const schedule = () => {
      closeTimer = setTimeout(() => {
        setEyesOpen(false)
        openTimer = setTimeout(() => {
          setEyesOpen(true)
          schedule()
        }, 130)
      }, 2500 + Math.random() * 2000)
    }
    schedule()
    onCleanup(() => {
      clearTimeout(closeTimer)
      clearTimeout(openTimer)
    })
  })
  const lotusRowText = (row: string, i: number) => {
    if (i !== LOTUS_EYE_ROW) return row
    return (
      EYE_PREFIX +
      (eyesOpen() ? LEFT_EYE_OPEN : LEFT_EYE_CLOSED) +
      EYE_MIDDLE +
      (eyesOpen() ? RIGHT_EYE_OPEN : RIGHT_EYE_CLOSED) +
      EYE_SUFFIX
    )
  }

  // Popping pink used for both the centered and corner "lotus" wordmarks.
  const LOTUS_PINK = { r: 0xE6, g: 0x3D, b: 0x8A }   // hot rose — pops on either palette

  // Fade interpolation targets against the active theme's bg color so the
  // "fade to invisible" effect actually blends with the surface.
  const bgRgb = () => parseHex(PALETTE.bg)

  const lotusFadeColor = () => {
    const t = transitionT()
    return RGBA.fromHex(blendHex(LOTUS_PINK, bgRgb(), t))
  }
  const centerLabelColor = () => {
    const t = transitionT()
    return RGBA.fromHex(blendHex(LOTUS_PINK, bgRgb(), t))
  }
  const cornerLabelColor = () => {
    // Reverse — bg → pink as t → 1.
    const t = hasStartedChat() ? transitionT() : 0
    return RGBA.fromHex(blendHex(bgRgb(), LOTUS_PINK, t))
  }

  // Weird circular symbol next to the spinner word — cycles fast through a
  // grab-bag of dots, half-circles, asterisks and braille dots.
  const [spinnerSymbol, setSpinnerSymbol] = createSignal(pickSpinnerSymbol())
  createEffect(() => {
    if (!running()) return
    setSpinnerSymbol(pickSpinnerSymbol())
    const symbolTimer = setInterval(() => setSpinnerSymbol(pickSpinnerSymbol()), 90)
    onCleanup(() => clearInterval(symbolTimer))
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

  // ── @ file mention palette ──────────────────────────────────────────────
  const [mentionOpen, setMentionOpen] = createSignal(false)
  const [mentionQuery, setMentionQuery] = createSignal("")
  const [mentionResults, setMentionResults] = createSignal<string[]>([])
  const [mentionIndex, setMentionIndex] = createSignal(0)
  const [mentionScrollTop, setMentionScrollTop] = createSignal(0)
  const [mentionLoading, setMentionLoading] = createSignal(false)
  let mentionFetchSeq = 0
  let mentionFetchTimer: ReturnType<typeof setTimeout> | undefined
  // One-shot: set when completeMention runs so the Enter that selected the
  // file doesn't also trigger onSubmit → submit().
  let suppressNextSubmit = false

  function reconcileMentionScroll(nextIndex: number, count: number) {
    const maxTop = Math.max(0, count - MENTION_VIEWPORT)
    setMentionScrollTop((top) => {
      let next = Math.min(top, maxTop)
      if (nextIndex < next) next = nextIndex
      else if (nextIndex >= next + MENTION_VIEWPORT) next = nextIndex - MENTION_VIEWPORT + 1
      return Math.max(0, Math.min(next, maxTop))
    })
  }

  function moveMentionSelection(delta: number) {
    const list = mentionResults()
    if (list.length === 0) return
    const raw = mentionIndex() + delta
    const next = raw < 0 ? list.length - 1 : raw >= list.length ? 0 : raw
    setMentionIndex(next)
    reconcileMentionScroll(next, list.length)
  }

  function closeMention() {
    setMentionOpen(false)
    setMentionIndex(0)
    setMentionScrollTop(0)
    setMentionResults([])
    setMentionQuery("")
    setMentionLoading(false)
    if (mentionFetchTimer) { clearTimeout(mentionFetchTimer); mentionFetchTimer = undefined }
  }

  async function runMentionSearch(query: string) {
    const seq = ++mentionFetchSeq
    setMentionLoading(true)
    try {
      const q = encodeURIComponent(query)
      const res = await sdk.fetch(sdk.url + "/find/file?query=" + q + "&limit=50")
      if (seq !== mentionFetchSeq) return   // stale
      const data = (await res.json().catch(() => [])) as unknown
      const list = Array.isArray(data) ? (data as string[]) : []
      setMentionResults(list)
      setMentionIndex(0)
      setMentionScrollTop(0)
    } catch {
      if (seq === mentionFetchSeq) setMentionResults([])
    } finally {
      if (seq === mentionFetchSeq) setMentionLoading(false)
    }
  }

  // Returns the pending @-mention token at the caret if any, else null.
  // We approximate the caret by using the end of the plainText — good enough
  // for typing at the end of the input, which is the common case.
  function detectMentionAtEnd(text: string): { start: number; query: string } | null {
    const at = text.lastIndexOf("@")
    if (at < 0) return null
    // The @ must be at start, or preceded by whitespace/newline.
    if (at > 0 && !/\s/.test(text[at - 1] ?? "")) return null
    const tail = text.slice(at + 1)
    // If any whitespace after the @, it's no longer active.
    if (/\s/.test(tail)) return null
    return { start: at, query: tail }
  }

  function completeMention() {
    const list = mentionResults()
    const pick = list[mentionIndex()]
    if (!pick) return
    const text = inputEl?.plainText ?? ""
    const m = detectMentionAtEnd(text)
    if (!m) { closeMention(); return }
    const before = text.slice(0, m.start)
    const inserted = "@" + pick + " "
    const replaced = before + inserted
    suppressNextSubmit = true
    inputEl?.setText(replaced)
    // Place caret at the end of the inserted mention (after the trailing space)
    // so the user can immediately keep typing.
    if (inputEl) inputEl.cursorOffset = replaced.length
    closeMention()
    // setText fires onContentChange which re-runs highlightMentionsInInput,
    // but call it explicitly for safety in case the event is coalesced.
    highlightMentionsInInput()
  }

  // Clears and re-adds highlights for every "@\S+" token in the input buffer.
  function highlightMentionsInInput() {
    if (!inputEl) return
    const el = inputEl
    try {
      el.clearAllHighlights()
    } catch { /* no-op if not supported */ }
    const text = el.plainText ?? ""
    const re = /(^|\s)@\S+/g
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      const start = match.index + (match[1]?.length ?? 0)
      const end = start + (match[0].length - (match[1]?.length ?? 0))
      try {
        el.addHighlightByCharRange({ start, end, styleId: MENTION_STYLE_ID })
      } catch { /* no-op */ }
    }
  }

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

    // Slash palette
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

    // @ mention palette
    const m = detectMentionAtEnd(text)
    if (m) {
      setMentionOpen(true)
      if (m.query !== mentionQuery()) {
        setMentionQuery(m.query)
        if (mentionFetchTimer) clearTimeout(mentionFetchTimer)
        mentionFetchTimer = setTimeout(() => { void runMentionSearch(m.query) }, 90)
      }
    } else if (mentionOpen()) {
      closeMention()
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
  const [statusShine, setStatusShine] = createSignal(-4)
  let statusTimer: ReturnType<typeof setTimeout> | undefined
  function showStatus(text: string, kind: "info" | "warn" | "error" = "info") {
    setStatus({ text, kind })
    setStatusShine(-4)
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = setTimeout(() => setStatus(undefined), 3000)
  }
  onCleanup(() => statusTimer && clearTimeout(statusTimer))

  // Animate a highlight sweep across the status text while it's visible.
  createEffect(() => {
    const s = status()
    if (!s) return
    setStatusShine(-4)
    const shineTimer = setInterval(() => {
      setStatusShine((prev) => {
        const len = s.text.length + 8
        const next = prev + 0.6
        return next > len ? -4 : next
      })
    }, 55)
    onCleanup(() => clearInterval(shineTimer))
  })

  const statusBaseFor = (kind: "info" | "warn" | "error") =>
    kind === "error" ? STATUS_BASE_ERROR : kind === "warn" ? STATUS_BASE_WARN : STATUS_BASE_INFO

  // ── /agent modal ────────────────────────────────────────────────────────
  // Two phases:
  //   "select" — list existing agents + "+ New agent…" row. Enter switches to
  //     the selected agent (or opens create mode).
  //   "create" — inline wizard: name → description → mode. Each Enter on the
  //     main input captures that step's value. Esc cancels.
  const [agentModalPhase, setAgentModalPhase] = createSignal<AgentPalettePhase | null>(null)
  const agentModalOpen = () => agentModalPhase() !== null

  // Built-in agents that must not be deleted. Kept in sync with
  // AgentRegistry.builtInAgents() in @gco/controller-agent.
  const BUILT_IN_AGENT_IDS = new Set([
    "build", "explore", "plan", "general", "compaction", "title", "summary",
  ])

  function buildAgentSelectItems(): AgentPaletteItem[] {
    const cur = currentAgentName()
    const items: AgentPaletteItem[] = agents().map((a) => ({
      name: a.name,
      description: a.description,
      color: a.color,
      current: a.name === cur,
      deletable: !BUILT_IN_AGENT_IDS.has(a.name),
    }))
    items.push({ name: "__new__" })
    return items
  }

  function openAgentModal() {
    const items = buildAgentSelectItems()
    const curIdx = Math.max(0, items.findIndex((it) => it.current))
    setAgentModalPhase({ type: "select", items, index: curIdx })
  }

  function closeAgentModal() {
    setAgentModalPhase(null)
  }

  function moveAgentModalSelection(delta: number) {
    const p = agentModalPhase()
    if (!p || p.type !== "select") return
    const len = p.items.length
    const next = ((p.index + delta) % len + len) % len
    setAgentModalPhase({ ...p, index: next })
  }

  async function selectAgentFromModal(name: string) {
    const list = agents()
    const idx = list.findIndex((a) => a.name === name)
    if (idx < 0) { closeAgentModal(); return }
    setAgentIndex(idx)
    const sid = sessionID()
    if (sid) {
      await sdk.client.session.update({ sessionID: sid, agent: name }).catch(() => {})
    }
    closeAgentModal()
    showStatus(`Switched to ${name}`)
  }

  function confirmAgentModalSelection() {
    const p = agentModalPhase()
    if (!p || p.type !== "select") return
    const item = p.items[p.index]
    if (!item) return
    if (item.name === "__new__") {
      setAgentModalPhase({ type: "create", step: "name" })
      inputEl?.setText("")
      return
    }
    void selectAgentFromModal(item.name)
  }

  function requestDeleteFromModal() {
    const p = agentModalPhase()
    if (!p || p.type !== "select") return
    const item = p.items[p.index]
    if (!item || item.name === "__new__") return
    if (!item.deletable) {
      showStatus(`Cannot delete built-in agent '${item.name}'`, "warn")
      return
    }
    setAgentModalPhase({ type: "confirm", name: item.name, returnIndex: p.index, items: p.items })
  }

  async function confirmDeleteFromModal() {
    const p = agentModalPhase()
    if (!p || p.type !== "confirm") return
    const name = p.name
    try {
      const res = await sdk.fetch(sdk.url + "/agent/" + encodeURIComponent(name), { method: "DELETE" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
        showStatus(`Failed: ${err.error ?? res.statusText}`, "error")
        setAgentModalPhase({ type: "select", items: p.items, index: p.returnIndex })
        return
      }
    } catch (e) {
      showStatus(`Failed: ${String(e)}`, "error")
      setAgentModalPhase({ type: "select", items: p.items, index: p.returnIndex })
      return
    }

    // Refresh the agent list and reset selection.
    const listRes = await sdk.client.app.agents({}).catch(() => null)
    const list = (listRes?.data ?? []) as AgentEntry[]
    const primary = list.filter((a) => !a.hidden && a.mode !== "subagent")
    setAgents(primary)
    if (currentAgentName() === name) {
      const buildIdx = primary.findIndex((a) => a.name === "build")
      setAgentIndex(buildIdx >= 0 ? buildIdx : 0)
    }
    showStatus(`Deleted agent "${name}"`)

    // Rebuild the modal item list so the removed agent disappears.
    const items = buildAgentSelectItems()
    if (items.length <= 1) { closeAgentModal(); return }
    setAgentModalPhase({ type: "select", items, index: Math.min(p.returnIndex, items.length - 1) })
  }

  function cancelDeleteFromModal() {
    const p = agentModalPhase()
    if (!p || p.type !== "confirm") return
    setAgentModalPhase({ type: "select", items: p.items, index: p.returnIndex })
  }

  // ── /theme modal ────────────────────────────────────────────────────────
  const [themeModalOpen, setThemeModalOpen] = createSignal(false)
  const [themeIndex, setThemeIndex] = createSignal(0)

  const themeItems = (): ThemePaletteItem[] => {
    const items: ThemePaletteItem[] = [
      {
        name: "light",
        label: "Light",
        description: "warm cream paper — current default",
        swatchBg: LIGHT_PALETTE.bg,
        swatchFg: LIGHT_PALETTE.egg,
        current: ACTIVE_THEME === "light",
      },
      {
        name: "dark",
        label: "Dark",
        description: "beige on deep warm brown",
        swatchBg: DARK_PALETTE.bg,
        swatchFg: DARK_PALETTE.egg,
        current: ACTIVE_THEME === "dark",
      },
    ]
    return items
  }

  function openThemeModal() {
    setThemeIndex(ACTIVE_THEME === "dark" ? 1 : 0)
    setThemeModalOpen(true)
  }
  function closeThemeModal() { setThemeModalOpen(false) }

  function moveThemeSelection(delta: number) {
    const items = themeItems()
    const raw = themeIndex() + delta
    const next = raw < 0 ? items.length - 1 : raw >= items.length ? 0 : raw
    setThemeIndex(next)
  }

  async function selectTheme(name: ThemeName) {
    try {
      const dir = pathMod.dirname(GLOBAL_CONFIG_PATH)
      fs.mkdirSync(dir, { recursive: true })
      let existing: Record<string, unknown> = {}
      try { existing = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, "utf8")) } catch {}
      existing.theme = name
      fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(existing, null, 2) + "\n")
    } catch (e) {
      showStatus(`Failed to save theme: ${String(e)}`, "error")
      return
    }
    closeThemeModal()
    if (name === ACTIVE_THEME) showStatus(`Theme is already ${name}`)
    else showStatus(`Theme saved (${name}) — restart to apply`, "warn")
  }

  function confirmThemeSelection() {
    const item = themeItems()[themeIndex()]
    if (!item) return
    void selectTheme(item.name)
  }

  // ── /mcp modal ──────────────────────────────────────────────────────────
  const [mcpModalPhase, setMcpModalPhase] = createSignal<McpPalettePhase | null>(null)
  const mcpModalOpen = () => mcpModalPhase() !== null

  type ServerRow = { id: string; name: string; status: string; error?: string; config: any; tools: string[] }

  function toMcpItems(list: ServerRow[]): McpPaletteItem[] {
    const items: McpPaletteItem[] = list.map((s) => {
      const cmd = Array.isArray(s.config?.command) ? s.config.command.join(" ") : undefined
      return {
        name: s.name,
        status: s.status,
        error: s.error,
        command: cmd,
        toolCount: s.tools?.length,
      }
    })
    items.push({ name: "__new__", status: "" })
    return items
  }

  async function fetchMcpList(): Promise<ServerRow[]> {
    try {
      const res = await sdk.fetch(sdk.url + "/mcp")
      const data = await res.json().catch(() => null)
      // Server wraps the array in { servers, connected } — unwrap if needed.
      if (Array.isArray(data)) return data as ServerRow[]
      if (data && typeof data === "object" && Array.isArray((data as any).servers))
        return (data as any).servers as ServerRow[]
      return []
    } catch {
      return []
    }
  }

  async function openMcpModal() {
    const list = await fetchMcpList()
    const items = toMcpItems(list)
    setMcpModalPhase({ type: "select", items, index: 0 })
  }

  function closeMcpModal() { setMcpModalPhase(null) }

  function moveMcpModalSelection(delta: number) {
    const p = mcpModalPhase()
    if (!p || p.type !== "select") return
    const len = p.items.length
    const next = ((p.index + delta) % len + len) % len
    setMcpModalPhase({ ...p, index: next })
  }

  async function reconnectMcpFromModal(name: string) {
    try {
      const res = await sdk.fetch(sdk.url + "/mcp/" + encodeURIComponent(name) + "/connect", {
        method: "POST",
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
        showStatus(`Failed: ${err.error ?? res.statusText}`, "error")
        return
      }
      showStatus(`Reconnecting "${name}"…`)
      // Give the connect a moment, then refresh.
      setTimeout(async () => {
        const list = await fetchMcpList()
        const p = mcpModalPhase()
        if (p && p.type === "select") {
          const items = toMcpItems(list)
          setMcpModalPhase({ type: "select", items, index: Math.min(p.index, items.length - 1) })
        }
      }, 400)
    } catch (e) {
      showStatus(`Failed: ${String(e)}`, "error")
    }
  }

  function confirmMcpModalSelection() {
    const p = mcpModalPhase()
    if (!p || p.type !== "select") return
    const item = p.items[p.index]
    if (!item) return
    if (item.name === "__new__") {
      setMcpModalPhase({ type: "create", step: "name" })
      inputEl?.setText("")
      return
    }
    if (item.status !== "connected") void reconnectMcpFromModal(item.name)
    else showStatus(`"${item.name}" is already connected`)
  }

  function requestDeleteMcpFromModal() {
    const p = mcpModalPhase()
    if (!p || p.type !== "select") return
    const item = p.items[p.index]
    if (!item || item.name === "__new__") return
    setMcpModalPhase({ type: "confirm", name: item.name, returnIndex: p.index, items: p.items })
  }

  async function confirmDeleteMcpFromModal() {
    const p = mcpModalPhase()
    if (!p || p.type !== "confirm") return
    const name = p.name
    try {
      const res = await sdk.fetch(sdk.url + "/mcp/" + encodeURIComponent(name), { method: "DELETE" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
        showStatus(`Failed: ${err.error ?? res.statusText}`, "error")
        setMcpModalPhase({ type: "select", items: p.items, index: p.returnIndex })
        return
      }
    } catch (e) {
      showStatus(`Failed: ${String(e)}`, "error")
      setMcpModalPhase({ type: "select", items: p.items, index: p.returnIndex })
      return
    }
    const list = await fetchMcpList()
    const items = toMcpItems(list)
    showStatus(`Deleted MCP "${name}"`)
    if (items.length <= 1) { closeMcpModal(); return }
    setMcpModalPhase({ type: "select", items, index: Math.min(p.returnIndex, items.length - 1) })
  }

  function cancelDeleteMcpFromModal() {
    const p = mcpModalPhase()
    if (!p || p.type !== "confirm") return
    setMcpModalPhase({ type: "select", items: p.items, index: p.returnIndex })
  }

  function parseEnv(input: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const tok of input.split(/\s+/)) {
      if (!tok) continue
      const eq = tok.indexOf("=")
      if (eq <= 0) continue
      out[tok.slice(0, eq)] = tok.slice(eq + 1)
    }
    return out
  }

  async function submitNewMcp(name: string, commandLine: string, envInput: string) {
    const command = commandLine.split(/\s+/).filter(Boolean)
    const environment = parseEnv(envInput)
    const body: any = { name, type: "local", command }
    if (Object.keys(environment).length > 0) body.environment = environment
    try {
      const res = await sdk.fetch(sdk.url + "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
        showStatus(`Failed: ${err.error ?? res.statusText}`, "error")
        return
      }
      showStatus(`Added MCP "${name}" — connecting…`)
      // Refresh list into select phase.
      setTimeout(async () => {
        const list = await fetchMcpList()
        const items = toMcpItems(list)
        const idx = Math.max(0, items.findIndex((it) => it.name === name))
        setMcpModalPhase({ type: "select", items, index: idx })
      }, 400)
    } catch (e) {
      showStatus(`Failed: ${String(e)}`, "error")
    }
  }

  async function submitNewAgent(name: string, description: string, mode: "primary" | "subagent" | "all") {
    try {
      const res = await sdk.fetch(sdk.url + "/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, mode }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
        showStatus(`Failed: ${err.error ?? res.statusText}`, "error")
        return
      }
      const listRes = await sdk.client.app.agents({}).catch(() => null)
      const list = (listRes?.data ?? []) as AgentEntry[]
      const primary = list.filter((a) => !a.hidden && a.mode !== "subagent")
      if (primary.length > 0) setAgents(primary)
      showStatus(`Agent "${name}" created`)
    } catch (e) {
      showStatus(`Failed: ${String(e)}`, "error")
    }
  }

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
      case "agent": {
        openAgentModal()
        return
      }
      case "mcp": {
        void openMcpModal()
        return
      }
      case "theme": {
        openThemeModal()
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
      // Theme modal open: navigate + select.
      if (themeModalOpen()) {
        if (key.name === "escape") { closeThemeModal(); key.preventDefault(); return }
        if (key.name === "up") { moveThemeSelection(-1); key.preventDefault(); return }
        if (key.name === "down") { moveThemeSelection(1); key.preventDefault(); return }
        if (key.name === "return") { confirmThemeSelection(); key.preventDefault(); return }
        return
      }

      // MCP modal open: intercept navigation keys.
      const mcp = mcpModalPhase()
      if (mcp) {
        if (mcp.type === "confirm") {
          if (key.name === "escape" || key.name === "n") {
            cancelDeleteMcpFromModal(); key.preventDefault(); return
          }
          if (key.name === "y" || key.name === "return") {
            void confirmDeleteMcpFromModal(); key.preventDefault(); return
          }
          key.preventDefault()
          return
        }
        if (key.name === "escape") { closeMcpModal(); key.preventDefault(); return }
        if (mcp.type === "select") {
          if (key.name === "up") { moveMcpModalSelection(-1); key.preventDefault(); return }
          if (key.name === "down") { moveMcpModalSelection(1); key.preventDefault(); return }
          if (key.name === "return") { confirmMcpModalSelection(); key.preventDefault(); return }
          if (key.name === "d") { requestDeleteMcpFromModal(); key.preventDefault(); return }
        }
        // In "create" phase, let text keys reach the input; only Esc handled above.
        return
      }

      // Agent modal open: intercept navigation keys.
      const modal = agentModalPhase()
      if (modal) {
        if (modal.type === "confirm") {
          if (key.name === "escape" || key.name === "n") {
            cancelDeleteFromModal()
            key.preventDefault()
            return
          }
          if (key.name === "y" || key.name === "return") {
            void confirmDeleteFromModal()
            key.preventDefault()
            return
          }
          // Swallow other keys so they don't reach the input while confirming.
          key.preventDefault()
          return
        }
        if (key.name === "escape") {
          closeAgentModal()
          key.preventDefault()
          return
        }
        if (modal.type === "select") {
          if (key.name === "up") { moveAgentModalSelection(-1); key.preventDefault(); return }
          if (key.name === "down") { moveAgentModalSelection(1); key.preventDefault(); return }
          if (key.name === "return") { confirmAgentModalSelection(); key.preventDefault(); return }
          if (key.name === "d") { requestDeleteFromModal(); key.preventDefault(); return }
        }
        // In "create" phase, let text keys reach the input; only Esc is handled.
        return
      }

      // @ mention palette open: navigate + complete. Swallow tab/return even
      // when results are empty (e.g. still loading) so Enter never accidentally
      // submits the message while the palette is up.
      if (mentionOpen()) {
        if (key.name === "escape") { closeMention(); key.preventDefault(); return }
        const list = mentionResults()
        if (key.name === "up" && list.length > 0) { moveMentionSelection(-1); key.preventDefault(); return }
        if (key.name === "down" && list.length > 0) { moveMentionSelection(1); key.preventDefault(); return }
        if (key.name === "tab" || key.name === "return") {
          if (list.length > 0) completeMention()
          key.preventDefault()
          return
        }
      }

      // Slash palette closed: tab cycles the active agent forward.
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
    if (running()) return
    // Empty input is allowed for wizard steps that accept blanks (mcp "env",
    // agent "mode" defaults). Only bail early on empty text when NO wizard is
    // active, since the actual prompt path can't send an empty message.
    const wizardActive =
      (mcpModalPhase()?.type === "create") ||
      (agentModalPhase()?.type === "create")
    if (!text && !wizardActive) return

    // MCP modal in create phase: name → command → env.
    const mcpModal = mcpModalPhase()
    if (mcpModal && mcpModal.type === "create") {
      inputEl?.setText("")
      if (mcpModal.step === "name") {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(text)) {
          showStatus("Name must match [a-zA-Z][a-zA-Z0-9_-]* — try again", "warn")
          return
        }
        setMcpModalPhase({ type: "create", step: "command", name: text })
        return
      }
      if (mcpModal.step === "command") {
        if (!text) {
          showStatus("Command is required — try again", "warn")
          return
        }
        setMcpModalPhase({ type: "create", step: "env", name: mcpModal.name, command: text })
        return
      }
      if (mcpModal.step === "env") {
        const name = mcpModal.name!
        const cmd = mcpModal.command!
        await submitNewMcp(name, cmd, text)
        return
      }
    }

    // Agent modal in create phase: intercept submit for each wizard step.
    const modal = agentModalPhase()
    if (modal && modal.type === "create") {
      inputEl?.setText("")
      if (modal.step === "name") {
        if (!/^[a-z][a-z0-9-]*$/i.test(text)) {
          showStatus("Name must match [a-zA-Z][a-zA-Z0-9-]* — try again", "warn")
          return
        }
        setAgentModalPhase({ type: "create", step: "description", name: text })
        return
      }
      if (modal.step === "description") {
        setAgentModalPhase({ type: "create", step: "mode", name: modal.name, description: text })
        return
      }
      if (modal.step === "mode") {
        const modeInput = text.toLowerCase()
        const mode = (modeInput === "subagent" || modeInput === "all" || modeInput === "primary")
          ? modeInput
          : "primary"
        const name = modal.name!
        const description = modal.description!
        closeAgentModal()
        await submitNewAgent(name, description, mode)
        return
      }
    }

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
    // First real user submit — kicks the landing → chat hero transition.
    if (!hasStartedChat()) setHasStartedChat(true)
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
      {/* Corner wordmark — fades in as the landing transition completes. */}
      <Show when={hasStartedChat()}>
        <box
          flexShrink={0}
          flexDirection="row"
          justifyContent="flex-end"
          paddingLeft={3}
          paddingRight={3}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={C_BG}
        >
          <text fg={cornerLabelColor()} attributes={TextAttributes.BOLD}>
            lotus
          </text>
        </box>
      </Show>

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
        {/* Landing hero — centered ASCII lotus + wordmark, sits directly
            above the input while fresh; fades out during the transition. */}
        <Show when={transitionT() < 1}>
          <box
            flexGrow={1}
            flexDirection="column"
            justifyContent="flex-end"
            alignItems="center"
            paddingBottom={1}
          >
            <For each={lotusArt}>
              {(row, i) => (
                <text fg={lotusFadeColor()}>{lotusRowText(row, i())}</text>
              )}
            </For>
            <box height={1} />
            <text fg={centerLabelColor()} attributes={TextAttributes.BOLD}>
              lotus
            </text>
          </box>
        </Show>
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
              <box flexDirection="row" gap={1}>
                <text>
                  <b style={{ fg: C_EGG }}>{spinnerSymbol()}</b>
                </text>
                <text>
                  {/* Index (not For) — chars in the word repeat (e.g. two "c"s in
                      "Concocting"), and For's referential-keying gets confused when
                      primitive items collide, leaving stale nodes from the prior
                      word bleeding into the new one. */}
                  <Index each={(spinnerWord() + "…").split("")}>
                    {(ch, i) => <span style={{ fg: shineColorFor(i, shinePos()) }}>{ch()}</span>}
                  </Index>
                </text>
              </box>
            </Show>
            <Show when={streamingStats()}>
              <text fg={C_DIM}>{streamingStats()}</text>
            </Show>
          </box>
        </Show>
      </scrollbox>

      {/* Divider — doubles as the status bar. Italic status messages render
          right-aligned inside the dark-shaded band. */}
      <box
        height={1}
        flexDirection="row"
        justifyContent="flex-end"
        paddingLeft={2}
        paddingRight={2}
        backgroundColor={C_MUTED}
      >
        <Show when={status()}>
          {(s) => (
            <text attributes={TextAttributes.ITALIC | TextAttributes.BOLD}>
              <Index each={s().text.split("")}>
                {(ch, i) => (
                  <span style={{ fg: shineBetween(i, statusShine(), statusBaseFor(s().kind), STATUS_PEAK) }}>
                    {ch()}
                  </span>
                )}
              </Index>
            </text>
          )}
        </Show>
      </box>

      {/* Slash command palette (appears when input starts with "/") */}
      <SlashPalette
        visible={paletteOpen}
        commands={paletteMatches}
        selected={paletteIndex}
        scrollTop={paletteScrollTop}
      />

      {/* Agent modal (opens on /agent) */}
      <AgentPalette
        visible={agentModalOpen}
        phase={() => agentModalPhase() as AgentPalettePhase}
        agentColor={agentColor}
      />

      {/* MCP modal (opens on /mcp) */}
      <McpPalette
        visible={mcpModalOpen}
        phase={() => mcpModalPhase() as McpPalettePhase}
      />

      {/* Theme modal (opens on /theme) */}
      <ThemePalette
        visible={themeModalOpen}
        items={themeItems}
        index={themeIndex}
        bg={() => C_INPUT}
        border={() => C_MUTED}
        text={() => C_EGG}
        dim={() => C_DIM}
        selBg={() => C_USER_BG}
        accent={() => C_ACCENT}
      />

      {/* @ mention palette (appears when typing @<query> in the input) */}
      <MentionPalette
        visible={mentionOpen}
        query={mentionQuery}
        results={mentionResults}
        selected={mentionIndex}
        scrollTop={mentionScrollTop}
        loading={mentionLoading}
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
          syntaxStyle={INPUT_SYNTAX}
          onContentChange={() => { updatePaletteFromInput(); highlightMentionsInInput() }}
          onSubmit={() => {
            if (suppressNextSubmit) { suppressNextSubmit = false; return }
            if (mentionOpen()) {
              if (mentionResults().length > 0) completeMention()
              return
            }
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

      {/* Landing spacer — mirrors the scrollbox's flexGrow so the input
          floats to the vertical center of the terminal during the hero
          screen; unmounts once the transition completes. */}
      <Show when={transitionT() < 1}>
        <box flexGrow={1} backgroundColor={C_BG} />
      </Show>

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
