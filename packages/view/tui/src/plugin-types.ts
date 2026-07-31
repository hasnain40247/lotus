// Local stubs for plugin types - plugin system has been removed
// These types are kept for compatibility with feature-plugins that haven't been fully refactored

import type { JSX } from "solid-js"
import type {
  Config,
  Event,
  LspStatus,
  McpStatus,
  Message,
  Part,
  PermissionRequest,
  Provider,
  QuestionRequest,
  Session,
  Todo,
} from "@gco/sdk/v2"

export type TuiSlotProps<Name extends string = string> = {
  name: Name
  mode?: "replace" | "single_winner"
  ref?: unknown
  [key: string]: unknown
}

export type TuiSlotMap<Slots extends Record<string, object> = {}> = Slots

export type TuiSlotContext = {
  theme: TuiTheme
}

export type TuiAttentionWhen = "always" | "focused" | "blurred"

export type TuiAttentionNotifyResult = {
  ok: boolean
  notification: boolean
  sound: boolean
  skipped?: string
}

export type TuiAttentionNotifyInput = {
  message?: string
  title?: string
  notification?: boolean | { when?: TuiAttentionWhen }
  sound?: boolean | { name?: string }
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

export type TuiDialogSelectOption<Value = unknown> = {
  title: string
  value: Value
  description?: string
  footer?: string
  category?: string
  disabled?: boolean
  onSelect?: (dialog: TuiDialogContext) => void | Promise<void>
}

export type TuiDialogContext = {
  replace(render: () => JSX.Element, onClose?: () => void): void
  clear(): void
  setSize(size: string): void
  size: string
  depth: number
  open: boolean
}

export type TuiRouteDefinition = {
  name: string
  render: (props: { params?: Record<string, unknown> }) => JSX.Element
}

export type TuiRouteCurrent = {
  name: string
  params?: Record<string, unknown>
}

export type TuiCommand = {
  value: string
  title: string
  description?: string
  category?: string
  suggested?: boolean
  hidden?: boolean
  enabled?: (() => boolean) | boolean
  keybind?: string
  slash?: { name?: string; aliases?: string[] }
  onSelect?: (dialog: TuiDialogContext) => void | Promise<void>
}

export type TuiKV = {
  get<Value = unknown>(key: string, defaultValue?: Value): unknown
  set(key: string, value: unknown): void
  ready: boolean
}

// Re-export RGBA from @opentui/core for use in theme types
import type { RGBA } from "@opentui/core"

export type TuiThemeCurrent = {
  readonly primary: RGBA
  readonly secondary: RGBA
  readonly accent: RGBA
  readonly error: RGBA
  readonly warning: RGBA
  readonly success: RGBA
  readonly info: RGBA
  readonly text: RGBA
  readonly textMuted: RGBA
  readonly selectedListItemText: RGBA
  readonly background: RGBA
  readonly backgroundPanel: RGBA
  readonly backgroundElement: RGBA
  readonly backgroundMenu: RGBA
  readonly border: RGBA
  readonly borderActive: RGBA
  readonly borderSubtle: RGBA
  readonly diffAdded: RGBA
  readonly diffRemoved: RGBA
  readonly diffContext: RGBA
  readonly diffHunkHeader: RGBA
  readonly diffHighlightAdded: RGBA
  readonly diffHighlightRemoved: RGBA
  readonly diffAddedBg: RGBA
  readonly diffRemovedBg: RGBA
  readonly diffContextBg: RGBA
  readonly diffLineNumber: RGBA
  readonly diffAddedLineNumberBg: RGBA
  readonly diffRemovedLineNumberBg: RGBA
  readonly markdownText: RGBA
  readonly markdownHeading: RGBA
  readonly markdownLink: RGBA
  readonly markdownLinkText: RGBA
  readonly markdownCode: RGBA
  readonly markdownBlockQuote: RGBA
  readonly markdownEmph: RGBA
  readonly markdownStrong: RGBA
  readonly markdownHorizontalRule: RGBA
  readonly markdownListItem: RGBA
  readonly markdownListEnumeration: RGBA
  readonly markdownImage: RGBA
  readonly markdownImageText: RGBA
  readonly markdownCodeBlock: RGBA
  readonly syntaxComment: RGBA
  readonly syntaxKeyword: RGBA
  readonly syntaxFunction: RGBA
  readonly syntaxVariable: RGBA
  readonly syntaxString: RGBA
  readonly syntaxNumber: RGBA
  readonly syntaxType: RGBA
  readonly syntaxOperator: RGBA
  readonly syntaxPunctuation: RGBA
  readonly thinkingOpacity: number
}

export type TuiTheme = {
  readonly current: TuiThemeCurrent
  readonly selected: string
  has: (name: string) => boolean
  set: (name: string) => boolean
  install: (jsonPath: string) => Promise<void>
  mode: () => "dark" | "light"
  readonly ready: boolean
}

export type TuiSidebarMcpItem = {
  name: string
  status: McpStatus["status"]
  error?: string
}

export type TuiSidebarLspItem = {
  id: string
  name: string
  root: string
  status: LspStatus["status"]
}

export type TuiSidebarFileItem = {
  file: string
  additions: number
  deletions: number
}

export type TuiSidebarTodoItem = {
  content: string
  status: string
  priority: string
}

export type TuiState = {
  readonly ready: boolean
  readonly config: Config
  readonly provider: ReadonlyArray<Provider>
  readonly path: {
    state: string
    config: string
    worktree: string
    directory: string
  }
  readonly vcs: { branch?: string; default_branch?: string } | undefined
  session: {
    count: () => number
    get: (sessionID: string) => Session | undefined
    diff: (sessionID: string) => ReadonlyArray<TuiSidebarFileItem>
    todo: (sessionID: string) => ReadonlyArray<Todo>
    messages: (sessionID: string) => ReadonlyArray<Message>
    status: (sessionID: string) => string | undefined
    permission: (sessionID: string) => ReadonlyArray<PermissionRequest>
    question: (sessionID: string) => ReadonlyArray<QuestionRequest>
  }
  part: (messageID: string) => ReadonlyArray<Part>
  lsp: () => ReadonlyArray<TuiSidebarLspItem>
  mcp: () => ReadonlyArray<TuiSidebarMcpItem>
}

export type TuiEventBus = {
  on: <Type extends Event["type"]>(type: Type, handler: (event: Extract<Event, { type: Type }>) => void) => () => void
}

export type TuiPluginStatus = {
  id: string
  name: string
  version?: string
  enabled: boolean
  active: boolean
  source: "file" | "npm" | "internal"
  spec: string
  target: string
  error?: string
}

export type TuiPluginInstallOptions = {
  force?: boolean
  global?: boolean
}

export type TuiPluginInstallResult = {
  ok: boolean
  message?: string
  missing?: string[]
  dir?: string
  tui?: boolean
}

export type TuiPluginApi = {
  app: { version: string }
  attention: TuiAttention
  command: {
    register(cb: () => TuiCommand[]): () => void
    trigger(value: string): void
    show(): void
  }
  keys: {
    formatSequence(parts: unknown): string
    formatBindings(bindings: unknown): string | undefined
  }
  keymap: {
    registerLayer(opts: { commands?: unknown; bindings?: unknown; priority?: number }): () => void
    parseKeySequence?: (seq: unknown) => unknown
    [key: string]: unknown
  }
  mode: {
    current(): string
    push(mode: string): () => void
  }
  route: {
    register(list: TuiRouteDefinition[]): () => void
    navigate(name: string, params?: Record<string, unknown>): void
    current: TuiRouteCurrent
  }
  ui: {
    Dialog(props: { size?: string; onClose?: () => void; children: JSX.Element }): JSX.Element
    DialogAlert(props: { title: string; message: string; onClose?: () => void }): JSX.Element
    DialogConfirm(props: { title: string; message: string; onClose?: (result: boolean) => void }): JSX.Element
    DialogPrompt(props: { title: string; description?: string | (() => JSX.Element); placeholder?: string; onClose?: (result?: string) => void; onConfirm?: (result: string) => void; onCancel?: () => void; busy?: boolean; busyText?: string; enabled?: boolean; bindings?: unknown[] }): JSX.Element
    DialogSelect<Value>(props: {
      title: string
      placeholder?: string
      options: TuiDialogSelectOption<Value>[]
      flat?: boolean
      skipFilter?: boolean
      current?: Value
      onMove?: (item: TuiDialogSelectOption<Value>) => void
      onFilter?: (query: string) => void
      onSelect?: (item: TuiDialogSelectOption<Value>) => void
    }): JSX.Element
    Slot<Name extends string>(props: TuiSlotProps<Name>): JSX.Element | null
    Prompt(props: {
      sessionID?: string
      visible?: boolean
      disabled?: boolean
      onSubmit?: () => void
      ref?: unknown
      hint?: string
      right?: JSX.Element
      showPlaceholder?: boolean
      placeholders?: unknown
    }): JSX.Element
    toast(input: { title?: string; message: string; variant?: string; duration?: number }): void
    dialog: TuiDialogContext
  }
  tuiConfig: {
    theme?: string
    leader_timeout?: number
    keybinds?: {
      readonly bindings: unknown[]
      get: (command: string) => unknown[]
      has: (command: string) => boolean
      gather: (name: string, commands: readonly string[]) => unknown[]
      pick: (name: string, commands: readonly string[]) => unknown[]
      omit: (name: string, commands: readonly string[]) => unknown[]
    }
    [key: string]: unknown
  }
  kv: TuiKV
  state: TuiState
  client: {
    session: {
      messages(params: { sessionID: string; [key: string]: unknown }, opts?: unknown): Promise<{ data?: unknown[] }>
      diff(params: { sessionID: string; [key: string]: unknown }, opts?: unknown): Promise<{ data?: unknown[] }>
      [key: string]: unknown
    }
    vcs: {
      diff(params: { [key: string]: unknown }, opts?: unknown): Promise<{ data?: unknown[] }>
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  event: TuiEventBus
  renderer: unknown
  slots: {
    register(plugin: { order?: number; slots: Record<string, ((_ctx?: unknown, props?: Record<string, unknown>) => JSX.Element) | (() => JSX.Element)> }): () => void
  }
  plugins: {
    list(): TuiPluginStatus[]
    activate(id: string): Promise<boolean>
    deactivate(id: string): Promise<boolean>
    add(spec: string): Promise<boolean>
    install(spec: string, options?: TuiPluginInstallOptions): Promise<TuiPluginInstallResult>
  }
  theme: TuiTheme
  lifecycle: {
    signal: AbortSignal
    onDispose(fn: () => void): () => void
  }
}

export type TuiPlugin = (api: TuiPluginApi) => void | Promise<void>

export type TuiPluginModule = {
  id: string
  tui: TuiPlugin
}
