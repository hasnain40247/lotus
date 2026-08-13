import { render } from "@opentui/solid"
import { registerLotusCodeSpinner } from "./component/register-spinner"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { Deferred, Effect } from "effect"
import { Flag } from "./flag"
import { ExitProvider, useExit } from "./context/exit"
import { EpilogueProvider } from "./context/epilogue"
import { createCliRenderer, RGBA, SyntaxStyle, type TextareaRenderable, type KeyEvent } from "@opentui/core"
import {
  Switch,
  Match,
  ErrorBoundary,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  For,
  Show,
} from "solid-js"
import { createStore } from "solid-js/store"
import { ErrorComponent } from "./component/error-component"
import { SDKProvider, useSDK } from "./context/sdk"
import { registerLotusCodeKeymap } from "./keymap"
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
}

// ─── ToolRow ───────────────────────────────────────────────────────────────────

function ToolRow(props: { part: ChatPart }) {
  const [collapsed, setCollapsed] = createSignal(true)
  const status = () => props.part.state?.status ?? "running"
  const name = () => props.part.tool ?? "tool"
  const inputStr = () => {
    const inp = props.part.state?.input
    if (!inp) return ""
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
      <Show when={hasOutput() && !collapsed()}>
        <text fg={C_DIM} wrapMode="word" paddingLeft={2}>
          {output()}
        </text>
      </Show>
    </box>
  )
}

// ─── AssistantRow ──────────────────────────────────────────────────────────────

function AssistantRow(props: { parts: () => ChatPart[] }) {
  return (
    <box paddingTop={1} paddingLeft={4} paddingRight={4} flexShrink={0} gap={0}>
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
              <ToolRow part={part} />
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
}

const partKey = (messageID: string, partID: string) => `${messageID}::${partID}`

function MessageRow(props: { msgID: string; store: StoreShape }) {
  const msg = () => props.store.msgs[props.msgID]
  const parts = () =>
    (props.store.partOrder[props.msgID] ?? []).map((key) => props.store.parts[key]).filter(Boolean)

  return (
    <Show when={msg()}>
      {(m) => (
        <Show when={m().role === "user"} fallback={<AssistantRow parts={parts} />}>
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

  const [sessionID, setSessionID] = createSignal<string | null>(null)
  const [running, setRunning] = createSignal(false)
  const [spinnerWord, setSpinnerWord] = createSignal(pickSpinnerWord())
  const [shinePos, setShinePos] = createSignal(0)
  const [store, setStore] = createStore<StoreShape>({
    msgOrder: [],
    msgs: {},
    partOrder: {},
    parts: {},
  })

  createEffect(() => {
    if (!running()) return
    setSpinnerWord(pickSpinnerWord())
    const wordTimer = setInterval(() => setSpinnerWord(pickSpinnerWord()), 2500)
    onCleanup(() => clearInterval(wordTimer))
  })

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

  onMount(() => {
    const off = sdk.event.on("event", (rawEvent) => {
      const payload = rawEvent.payload
      if (payload.type === "message.updated") {
        const msg = payload.properties.info
        if (!store.msgOrder.includes(msg.id)) {
          setStore("msgOrder", (prev) => [...prev, msg.id])
        }
        setStore("msgs", msg.id, {
          id: msg.id,
          role: msg.role as "user" | "assistant",
        })
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
    inputEl?.setText("")

    let sid = sessionID()
    if (!sid) {
      const res = await sdk.client.session
        .create({
          agent: "build",
          model: { providerID: "deepseek", id: "deepseek-chat" },
        })
        .catch(() => null)
      if (!res?.data?.id) return
      sid = res.data.id
      setSessionID(sid)
    }
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
          {(msgID) => <MessageRow msgID={msgID} store={store} />}
        </For>
        <Show when={running()}>
          <box paddingLeft={4} paddingTop={1} flexShrink={0}>
            <text>
              <For each={(spinnerWord() + "…").split("")}>
                {(ch, i) => <span style={{ fg: shineColorFor(i(), shinePos()) }}>{ch}</span>}
              </For>
            </text>
          </box>
        </Show>
      </scrollbox>

      {/* Divider */}
      <box height={1} backgroundColor={C_MUTED} />

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
        <text fg={C_DIM}>{"  "}</text>
        <textarea
          ref={(el: TextareaRenderable) => {
            inputEl = el
            el?.focus()
          }}
          flexGrow={1}
          textColor={C_EGG}
          backgroundColor={C_INPUT}
          cursorColor={C_EGG}
          maxHeight={8}
          onSubmit={() => {
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
    </box>
  )
}
