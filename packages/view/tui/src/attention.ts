import type { TuiConfig } from "./config"
import stripAnsi from "strip-ansi"

// Inline types previously imported from @opencode-ai/plugin/tui
export type TuiAttentionWhen = "always" | "focused" | "blurred"
export type TuiAttentionNotifySkipReason =
  | "attention_disabled"
  | "renderer_destroyed"
  | "empty_message"
  | "focus_unknown"
  | "focused"
  | "blurred"

export type TuiAttentionNotifyResult = {
  ok: boolean
  notification: boolean
  sound: boolean
  skipped?: TuiAttentionNotifySkipReason
}

export type TuiAttentionNotifyInput = {
  message?: string
  title?: string
  notification?: boolean | { when?: TuiAttentionWhen }
}

export type TuiKV = {
  get(key: string, defaultValue?: any): any
  set(key: string, value: any): void
}

export type TuiAttention = {
  notify(request: TuiAttentionNotifyInput): Promise<TuiAttentionNotifyResult>
  soundboard: {
    registerPack(): () => void
    activate(): boolean
    current(): string
    list(): string[]
  }
}

type FocusState = "unknown" | "focused" | "blurred"

type AttentionRenderer = {
  readonly isDestroyed: boolean
  on(event: "focus" | "blur", listener: () => void): unknown
  off(event: "focus" | "blur", listener: () => void): unknown
  triggerNotification(message: string, title?: string): boolean
}

type TuiAttentionHost = TuiAttention & {
  dispose(): void
}

const DEFAULT_TITLE = "gcloud-opencode"
const TITLE_LIMIT = 80
const MESSAGE_LIMIT = 240

function skipped(reason: TuiAttentionNotifySkipReason): TuiAttentionNotifyResult {
  return { ok: false, notification: false, sound: false, skipped: reason }
}

function normalizeText(input: string | undefined, fallback: string, limit: number) {
  const text = stripAnsi(input ?? "")
    .replace(/[ \t]*[\r\n]+[ \t]*/g, " ")
    .replace(/[ 	\u001c-\u001f]/g, "")
    .trim()
  const normalized = text.length ? text : fallback
  return Array.from(normalized).slice(0, limit).join("")
}

function focusSkip(when: TuiAttentionWhen, focus: FocusState) {
  if (when === "always") return
  if (focus === "unknown") return "focus_unknown"
  if (when === "blurred" && focus === "focused") return "focused"
  if (when === "focused" && focus === "blurred") return "blurred"
}

export function createTuiAttention(input: {
  renderer: AttentionRenderer
  config: Pick<TuiConfig.Resolved, "attention">
  kv?: TuiKV
}): TuiAttentionHost {
  let focus: FocusState = "unknown"
  let disposed = false

  const onFocus = () => { focus = "focused" }
  const onBlur = () => { focus = "blurred" }

  input.renderer.on("focus", onFocus)
  input.renderer.on("blur", onBlur)

  return {
    async notify(request: TuiAttentionNotifyInput): Promise<TuiAttentionNotifyResult> {
      if (!input.config.attention.enabled) return skipped("attention_disabled")
      if (disposed || input.renderer.isDestroyed) return skipped("renderer_destroyed")

      const message = normalizeText(request.message, "", MESSAGE_LIMIT)
      if (!message) return skipped("empty_message")

      const requestedNotification = typeof request.notification === "object" ? request.notification : undefined
      const notificationSkip = focusSkip(requestedNotification?.when ?? "blurred", focus)
      const notificationRequested = input.config.attention.notifications && request.notification !== false
      const shouldNotify = notificationRequested && !notificationSkip

      const notification = shouldNotify
        ? (() => {
            try {
              return input.renderer.triggerNotification(
                message,
                normalizeText(request.title, DEFAULT_TITLE, TITLE_LIMIT),
              )
            } catch {
              return false
            }
          })()
        : false

      if (!notification && notificationRequested && notificationSkip) return skipped(notificationSkip)

      return { ok: notification, notification, sound: false }
    },
    soundboard: {
      registerPack() { return () => {} },
      activate() { return false },
      current() { return "" },
      list() { return [] },
    },
    dispose() {
      if (disposed) return
      disposed = true
      input.renderer.off("focus", onFocus)
      input.renderer.off("blur", onBlur)
    },
  }
}
