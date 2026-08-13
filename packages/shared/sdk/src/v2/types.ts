// Ported from @lotus-code/sdk v2 gen/types.gen.ts
// All types needed by @gco/view-tui

export type ClientOptions = {
  baseUrl: `${string}://${string}` | (string & {})
}

// ─── Basic building blocks ────────────────────────────────────────────────────

export type JsonSchema = {
  [key: string]: unknown
}

export type ModelRef = {
  id: string
  providerID: string
  variant?: string
}

export type LocationRef = {
  directory: string
  workspaceID?: string
}

export type Range = {
  start: {
    line: number
    character: number
  }
  end: {
    line: number
    character: number
  }
}

export type SnapshotFileDiff = {
  file?: string
  patch?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

export type PermissionAction = "allow" | "deny" | "ask"

export type PermissionRule = {
  permission: string
  pattern: string
  action: PermissionAction
}

export type PermissionRuleset = Array<PermissionRule>

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type OAuth = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
  enterpriseUrl?: string
}

export type ApiAuth = {
  type: "api"
  key: string
  metadata?: {
    [key: string]: string
  }
}

export type WellKnownAuth = {
  type: "wellknown"
  key: string
  token: string
}

export type Auth = OAuth | ApiAuth | WellKnownAuth

export type CredentialOAuth = {
  type: "oauth"
  methodID: string
  refresh: string
  access: string
  expires: number
  metadata?: {
    [key: string]: unknown
  }
}

export type CredentialKey = {
  type: "key"
  key: string
  metadata?: {
    [key: string]: unknown
  }
}

export type CredentialValue = CredentialOAuth | CredentialKey

// ─── Errors ───────────────────────────────────────────────────────────────────

export type EffectHttpApiErrorBadRequest = {
  _tag: "BadRequest"
}

export type EffectHttpApiErrorInternalServerError = {
  _tag: "InternalServerError"
}

export type EffectHttpApiErrorForbidden = {
  _tag: "Forbidden"
}

export type InvalidRequestError = {
  _tag: "InvalidRequestError"
  message: string
  kind?: string
  field?: string
}

export type MoveSessionError = {
  name: "MoveSessionError"
  data: {
    message: string
  }
}

export type ProviderAuthError = {
  name: "ProviderAuthError"
  data: {
    providerID: string
    message: string
  }
}

export type UnknownError = {
  name: "UnknownError"
  data: {
    message: string
    ref?: string
  }
}

export type UnknownError1 = {
  _tag: "UnknownError"
  message: string
  ref?: string
}

export type MessageOutputLengthError = {
  name: "MessageOutputLengthError"
  data: {
    [key: string]: unknown
  }
}

export type MessageAbortedError = {
  name: "MessageAbortedError"
  data: {
    message: string
  }
}

export type StructuredOutputError = {
  name: "StructuredOutputError"
  data: {
    message: string
    retries: number
  }
}

export type ContextOverflowError = {
  name: "ContextOverflowError"
  data: {
    message: string
    responseBody?: string
  }
}

export type ContentFilterError = {
  name: "ContentFilterError"
  data: {
    message: string
  }
}

export type ApiError = {
  name: "APIError"
  data: {
    message: string
    statusCode?: number
    isRetryable: boolean
    responseHeaders?: {
      [key: string]: string
    }
    responseBody?: string
    metadata?: {
      [key: string]: string
    }
  }
}

export type SessionErrorUnknown = {
  type: "unknown"
  message: string
}

export type SessionNextRetryError = {
  message: string
  statusCode?: number
  isRetryable: boolean
  responseHeaders?: {
    [key: string]: string
  }
  responseBody?: string
  metadata?: {
    [key: string]: string
  }
}

export type NotFoundError = {
  name: "NotFoundError"
  data: {
    message: string
  }
}

export type SessionNotFoundError = {
  _tag: "SessionNotFoundError"
  sessionID: string
  message: string
}

export type SessionBusyError = {
  _tag: "SessionBusyError"
  sessionID: string
  message: string
}

export type MessageNotFoundError = {
  _tag: "MessageNotFoundError"
  sessionID: string
  messageID: string
  message: string
}

export type ProviderNotFoundError = {
  _tag: "ProviderNotFoundError"
  providerID: string
  message: string
}

export type ProjectNotFoundError = {
  _tag: "ProjectNotFoundError"
  projectID: string
  message: string
}

export type PtyNotFoundError = {
  _tag: "PtyNotFoundError"
  ptyID: string
  message: string
}

export type PtyForbiddenError = {
  _tag: "PtyForbiddenError"
  message: string
}

export type QuestionNotFoundError = {
  _tag: "QuestionNotFoundError"
  requestID: string
  message: string
}

export type PermissionNotFoundError = {
  _tag: "PermissionNotFoundError"
  requestID: string
  message: string
}

export type UnauthorizedError = {
  _tag: "UnauthorizedError"
  message: string
}

export type ForbiddenError = {
  _tag: "ForbiddenError"
  message: string
}

export type ConflictError = {
  _tag: "ConflictError"
  message: string
  resource?: string
}

export type ServiceUnavailableError = {
  _tag: "ServiceUnavailableError"
  message: string
  service?: string
}

export type InvalidCursorError = {
  _tag: "InvalidCursorError"
  message: string
}

export type BadRequestError = {
  name: "BadRequest"
  data: {
    message: string
    kind?: "Params" | "Headers" | "Query" | "Body" | "Payload"
  }
}

export type VcsApplyError = {
  name: "VcsApplyError"
  data: {
    message: string
    reason: "non-git" | "not-clean"
  }
}

export type WorktreeError = {
  name:
    | "WorktreeNotGitError"
    | "WorktreeNameGenerationFailedError"
    | "WorktreeCreateFailedError"
    | "WorktreeStartCommandFailedError"
    | "WorktreeRemoveFailedError"
    | "WorktreeResetFailedError"
    | "WorktreeListFailedError"
  data: {
    message: string
  }
}

export type WorkspaceCreateError = {
  name: "WorkspaceCreateError"
  data: {
    message: string
  }
}

export type WorkspaceWarpError = {
  name: "WorkspaceWarpError"
  data: {
    message: string
  }
}

export type ProjectCopyError = {
  name: "ProjectCopyError"
  data: {
    message: string
    forceRequired?: boolean
  }
}

export type McpUnsupportedOAuthError = {
  error: string
}

export type McpServerNotFoundError = {
  _tag: "McpServerNotFoundError"
  name: string
  message: string
}

export type ProviderAuthError1 = {
  name:
    | "BadRequest"
    | "ProviderAuthOauthMissing"
    | "ProviderAuthOauthCodeMissing"
    | "ProviderAuthOauthCallbackFailed"
    | "ProviderAuthValidationFailed"
  data: {
    providerID?: string
    field?: string
    message?: string
    kind?: string
  }
}

// ─── Session ──────────────────────────────────────────────────────────────────

export type RevertState = {
  messageID: string
  partID?: string
  snapshot?: string
  diff?: string
  files?: Array<FileDiff>
}

export type FileDiff = {
  path: string
  status: "added" | "modified" | "deleted"
  additions: number
  deletions: number
  patch: string
}

export type Session = {
  id: string
  slug: string
  projectID: string
  workspaceID?: string
  directory: string
  path?: string
  parentID?: string
  summary?: {
    additions: number
    deletions: number
    files: number
    diffs?: Array<SnapshotFileDiff>
  }
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  share?: {
    url: string
  }
  title: string
  agent?: string
  model?: {
    id: string
    providerID: string
    variant?: string
  }
  version: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
  permission?: PermissionRuleset
  revert?: {
    messageID: string
    partID?: string
    snapshot?: string
    diff?: string
  }
}

export type SessionStatus =
  | {
      type: "idle"
    }
  | {
      type: "retry"
      attempt: number
      message: string
      action?: {
        reason: string
        provider: string
        title: string
        message: string
        label: string
        link?: string
      }
      next: number
    }
  | {
      type: "busy"
    }

export type SessionActive = {
  type: "running"
}

export type SessionsResponse = {
  data: Array<SessionV2Info>
  cursor: {
    previous?: string
    next?: string
  }
}

export type SessionV2Info = {
  id: string
  parentID?: string
  projectID: string
  agent?: string
  model?: ModelRef
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  time: {
    created: number
    updated: number
    archived?: number
  }
  title: string
  location: LocationRef
  subpath?: string
  revert?: RevertState
}

export type GlobalSession = {
  id: string
  slug: string
  projectID: string
  workspaceID?: string
  directory: string
  path?: string
  parentID?: string
  summary?: {
    additions: number
    deletions: number
    files: number
    diffs?: Array<SnapshotFileDiff>
  }
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  share?: {
    url: string
  }
  title: string
  agent?: string
  model?: {
    id: string
    providerID: string
    variant?: string
  }
  version: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
  permission?: PermissionRuleset
  revert?: {
    messageID: string
    partID?: string
    snapshot?: string
    diff?: string
  }
  project: ProjectSummary | null
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export type OutputFormatText = {
  type: "text"
}

export type OutputFormatJsonSchema = {
  type: "json_schema"
  schema: JsonSchema
  retryCount?: number
}

export type OutputFormat = OutputFormatText | OutputFormatJsonSchema

export type OutputFormat1 =
  | {
      type: "text"
    }
  | {
      type: "json_schema"
      schema: JsonSchema
      retryCount?: number
    }

export type UserMessage = {
  id: string
  sessionID: string
  role: "user"
  time: {
    created: number
  }
  format?: OutputFormat
  summary?: {
    title?: string
    body?: string
    diffs: Array<SnapshotFileDiff>
  }
  agent: string
  model: {
    providerID: string
    modelID: string
    variant?: string
  }
  system?: string
  tools?: {
    [key: string]: boolean
  }
}

export type AssistantMessage = {
  id: string
  sessionID: string
  role: "assistant"
  time: {
    created: number
    completed?: number
  }
  error?:
    | ProviderAuthError
    | UnknownError
    | MessageOutputLengthError
    | MessageAbortedError
    | StructuredOutputError
    | ContextOverflowError
    | ContentFilterError
    | ApiError
  parentID: string
  modelID: string
  providerID: string
  mode: string
  agent: string
  path: {
    cwd: string
    root: string
  }
  summary?: boolean
  cost: number
  tokens: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  structured?: unknown
  variant?: string
  finish?: string
}

export type Message = UserMessage | AssistantMessage

// ─── Parts ────────────────────────────────────────────────────────────────────

export type TextPart = {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: {
    start: number
    end?: number
  }
  metadata?: {
    [key: string]: unknown
  }
}

export type SubtaskPart = {
  id: string
  sessionID: string
  messageID: string
  type: "subtask"
  prompt: string
  description: string
  agent: string
  model?: {
    providerID: string
    modelID: string
  }
  command?: string
}

export type ReasoningPart = {
  id: string
  sessionID: string
  messageID: string
  type: "reasoning"
  text: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    start: number
    end?: number
  }
}

export type FilePartSourceText = {
  value: string
  start: number
  end: number
}

export type FileSource = {
  text: FilePartSourceText
  type: "file"
  path: string
}

export type SymbolSource = {
  text: FilePartSourceText
  type: "symbol"
  path: string
  range: Range
  name: string
  kind: number
}

export type ResourceSource = {
  text: FilePartSourceText
  type: "resource"
  clientName: string
  uri: string
}

export type FilePartSource = FileSource | SymbolSource | ResourceSource

export type FilePart = {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: FilePartSource
}

export type ToolStatePending = {
  status: "pending"
  input: {
    [key: string]: unknown
  }
  raw: string
}

export type ToolStateRunning = {
  status: "running"
  input: {
    [key: string]: unknown
  }
  title?: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    start: number
  }
}

export type ToolStateCompleted = {
  status: "completed"
  input: {
    [key: string]: unknown
  }
  output: string
  title: string
  metadata: {
    [key: string]: unknown
  }
  time: {
    start: number
    end: number
    compacted?: number
  }
  attachments?: Array<FilePart>
}

export type ToolStateError = {
  status: "error"
  input: {
    [key: string]: unknown
  }
  error: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    start: number
    end: number
  }
}

export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError

export type ToolPart = {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: ToolState
  metadata?: {
    [key: string]: unknown
  }
}

export type StepStartPart = {
  id: string
  sessionID: string
  messageID: string
  type: "step-start"
  snapshot?: string
}

export type StepFinishPart = {
  id: string
  sessionID: string
  messageID: string
  type: "step-finish"
  reason: string
  snapshot?: string
  cost: number
  tokens: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
}

export type SnapshotPart = {
  id: string
  sessionID: string
  messageID: string
  type: "snapshot"
  snapshot: string
}

export type PatchPart = {
  id: string
  sessionID: string
  messageID: string
  type: "patch"
  hash: string
  files: Array<string>
}

export type AgentPart = {
  id: string
  sessionID: string
  messageID: string
  type: "agent"
  name: string
  source?: {
    value: string
    start: number
    end: number
  }
}

export type RetryPart = {
  id: string
  sessionID: string
  messageID: string
  type: "retry"
  attempt: number
  error: ApiError
  time: {
    created: number
  }
}

export type CompactionPart = {
  id: string
  sessionID: string
  messageID: string
  type: "compaction"
  auto: boolean
  overflow?: boolean
  tail_start_id?: string
}

export type Part =
  | TextPart
  | SubtaskPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | AgentPart
  | RetryPart
  | CompactionPart

// ─── Input types ──────────────────────────────────────────────────────────────

export type TextPartInput = {
  id?: string
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: {
    start: number
    end?: number
  }
  metadata?: {
    [key: string]: unknown
  }
}

export type FilePartInput = {
  id?: string
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: FilePartSource
}

export type AgentPartInput = {
  id?: string
  type: "agent"
  name: string
  source?: {
    value: string
    start: number
    end: number
  }
}

export type SubtaskPartInput = {
  id?: string
  type: "subtask"
  prompt: string
  description: string
  agent: string
  model?: {
    providerID: string
    modelID: string
  }
  command?: string
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

export type PromptSource = {
  start: number
  end: number
  text: string
}

export type PromptFileAttachment = {
  uri: string
  mime: string
  name?: string
  description?: string
  source?: PromptSource
}

export type PromptAgentAttachment = {
  name: string
  source?: PromptSource
}

export type Prompt = {
  text: string
  files?: Array<PromptFileAttachment>
  agents?: Array<PromptAgentAttachment>
}

export type PromptInputFileAttachment = {
  uri: string
  name?: string
  description?: string
  source?: PromptSource
}

export type PromptInput = {
  text: string
  files?: Array<PromptInputFileAttachment>
  agents?: Array<PromptAgentAttachment>
}

// ─── Providers ────────────────────────────────────────────────────────────────

export type ProviderRequest = {
  headers: {
    [key: string]: string
  }
  body: {
    [key: string]: unknown
  }
}

export type ProviderAisdk = {
  type: "aisdk"
  package: string
  url?: string
  settings?: {
    [key: string]: unknown
  }
}

export type ProviderNative = {
  type: "native"
  url?: string
  settings: {
    [key: string]: unknown
  }
}

export type ProviderApi = ProviderAisdk | ProviderNative

export type ProviderV2Info = {
  id: string
  integrationID?: string
  name: string
  disabled?: boolean
  api: ProviderApi
  request: ProviderRequest
}

export type Provider = {
  id: string
  name: string
  source: "env" | "config" | "custom" | "api"
  env: Array<string>
  key?: string
  options: {
    [key: string]: unknown
  }
  models: {
    [key: string]: Model
  }
}

export type ProviderAuthMethod = {
  type: "oauth" | "api"
  label: string
  prompts?: Array<
    | {
        type: "text"
        key: string
        message: string
        placeholder?: string
        when?: {
          key: string
          op: "eq" | "neq"
          value: string
        }
      }
    | {
        type: "select"
        key: string
        message: string
        options: Array<{
          label: string
          value: string
          hint?: string
        }>
        when?: {
          key: string
          op: "eq" | "neq"
          value: string
        }
      }
  >
}

export type ProviderAuthAuthorization = {
  url: string
  method: "auto" | "code"
  instructions: string
}

export type ProviderListResponses = {
  200: {
    all: Array<Provider>
    providers: Array<Provider>
    default: {
      [key: string]: string
    }
    connected: Array<string>
  }
}

export type ProviderListResponse = ProviderListResponses[keyof ProviderListResponses]

// ─── Models ───────────────────────────────────────────────────────────────────

export type ModelApi =
  | {
      id: string
      type: "aisdk"
      package: string
      url?: string
      settings?: {
        [key: string]: unknown
      }
    }
  | {
      id: string
      type: "native"
      url?: string
      settings: {
        [key: string]: unknown
      }
    }

export type ModelCapabilities = {
  tools: boolean
  input: Array<string>
  output: Array<string>
}

export type ModelCost = {
  tier?: {
    type: "context"
    size: number
  }
  input: number
  output: number
  cache: {
    read: number
    write: number
  }
}

export type ModelV2Info = {
  id: string
  providerID: string
  family?: string
  name: string
  api: ModelApi
  capabilities: ModelCapabilities
  request: {
    headers: {
      [key: string]: string
    }
    body: {
      [key: string]: unknown
    }
    variant?: string
  }
  variants: Array<{
    id: string
    headers: {
      [key: string]: string
    }
    body: {
      [key: string]: unknown
    }
  }>
  time: {
    released: number
  }
  cost: Array<ModelCost>
  status: "alpha" | "beta" | "deprecated" | "active"
  enabled: boolean
  limit: {
    context: number
    input?: number
    output: number
  }
}

export type Model = {
  id: string
  providerID: string
  api: {
    id: string
    url: string
    npm: string
  }
  name: string
  family?: string
  capabilities: {
    temperature: boolean
    reasoning: boolean
    attachment: boolean
    toolcall: boolean
    input: {
      text: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
    output: {
      text: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
    interleaved:
      | boolean
      | {
          field: "reasoning" | "reasoning_content" | "reasoning_details"
        }
  }
  cost: {
    input: number
    output: number
    cache: {
      read: number
      write: number
    }
    tiers?: Array<{
      input: number
      output: number
      cache: {
        read: number
        write: number
      }
      tier: {
        type: "context"
        size: number
      }
    }>
    experimentalOver200K?: {
      input: number
      output: number
      cache: {
        read: number
        write: number
      }
    }
  }
  limit: {
    context: number
    input?: number
    output: number
  }
  status: "alpha" | "beta" | "deprecated" | "active"
  options: {
    [key: string]: unknown
  }
  headers: {
    [key: string]: string
  }
  release_date: string
  variants?: {
    [key: string]: {
      [key: string]: unknown
    }
  }
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export type AgentColor = string | "primary" | "secondary" | "accent" | "success" | "warning" | "error" | "info"

export type PermissionV2Effect = "allow" | "deny" | "ask"

export type PermissionV2Rule = {
  action: string
  resource: string
  effect: PermissionV2Effect
}

export type PermissionV2Ruleset = Array<PermissionV2Rule>

export type AgentV2Info = {
  id: string
  model?: ModelRef
  request: ProviderRequest
  system?: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden: boolean
  color?: AgentColor
  steps?: number
  permissions: PermissionV2Ruleset
}

export type Agent = {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  topP?: number
  temperature?: number
  color?: string
  permission: PermissionRuleset
  model?: {
    modelID: string
    providerID: string
  }
  variant?: string
  prompt?: string
  options: {
    [key: string]: unknown
  }
  steps?: number
}

// ─── Config ───────────────────────────────────────────────────────────────────

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR"

export type ServerConfig = {
  port?: number
  hostname?: string
  mdns?: boolean
  mdnsDomain?: string
  cors?: Array<string>
}

export type PermissionActionConfig = "ask" | "allow" | "deny"

export type PermissionObjectConfig = {
  [key: string]: PermissionActionConfig
}

export type PermissionRuleConfig = PermissionActionConfig | PermissionObjectConfig

export type PermissionConfig =
  | PermissionActionConfig
  | {
      read?: PermissionRuleConfig
      edit?: PermissionRuleConfig
      glob?: PermissionRuleConfig
      grep?: PermissionRuleConfig
      list?: PermissionRuleConfig
      bash?: PermissionRuleConfig
      task?: PermissionRuleConfig
      external_directory?: PermissionRuleConfig
      todowrite?: PermissionActionConfig
      question?: PermissionActionConfig
      webfetch?: PermissionActionConfig
      websearch?: PermissionActionConfig
      lsp?: PermissionRuleConfig
      doom_loop?: PermissionActionConfig
      skill?: PermissionRuleConfig
      [key: string]: PermissionRuleConfig | PermissionActionConfig | undefined
    }

export type AgentConfig = {
  model?: string
  variant?: string
  temperature?: number
  top_p?: number
  prompt?: string
  tools?: {
    [key: string]: boolean
  }
  disable?: boolean
  description?: string
  mode?: "subagent" | "primary" | "all"
  hidden?: boolean
  options?: {
    [key: string]: unknown
  }
  color?: string | "primary" | "secondary" | "accent" | "success" | "warning" | "error" | "info"
  steps?: number
  maxSteps?: number
  permission?: PermissionConfig
  [key: string]:
    | unknown
    | string
    | number
    | {
        [key: string]: boolean
      }
    | boolean
    | "subagent"
    | "primary"
    | "all"
    | {
        [key: string]: unknown
      }
    | string
    | "primary"
    | "secondary"
    | "accent"
    | "success"
    | "warning"
    | "error"
    | "info"
    | number
    | PermissionConfig
    | undefined
}

export type ProviderConfig = {
  api?: string
  name?: string
  env?: Array<string>
  id?: string
  npm?: string
  whitelist?: Array<string>
  blacklist?: Array<string>
  options?: {
    apiKey?: string
    baseURL?: string
    enterpriseUrl?: string
    setCacheKey?: boolean
    timeout?: number | false
    headerTimeout?: number | false
    chunkTimeout?: number
    [key: string]: unknown | string | boolean | number | false | number | false | number | undefined
  }
  models?: {
    [key: string]: {
      id?: string
      name?: string
      family?: string
      release_date?: string
      attachment?: boolean
      reasoning?: boolean
      temperature?: boolean
      tool_call?: boolean
      interleaved?:
        | true
        | {
            field: "reasoning" | "reasoning_content" | "reasoning_details"
          }
      cost?: {
        input: number
        output: number
        cache_read?: number
        cache_write?: number
        context_over_200k?: {
          input: number
          output: number
          cache_read?: number
          cache_write?: number
        }
      }
      limit?: {
        context: number
        input?: number
        output: number
      }
      modalities?: {
        input?: Array<"text" | "audio" | "image" | "video" | "pdf">
        output?: Array<"text" | "audio" | "image" | "video" | "pdf">
      }
      experimental?: boolean
      status?: "alpha" | "beta" | "deprecated" | "active"
      provider?: {
        npm?: string
        api?: string
      }
      options?: {
        [key: string]: unknown
      }
      headers?: {
        [key: string]: string
      }
      variants?: {
        [key: string]: {
          disabled?: boolean
          [key: string]: unknown | boolean | undefined
        }
      }
    }
  }
}

export type McpLocalConfig = {
  type: "local"
  command: Array<string>
  cwd?: string
  environment?: {
    [key: string]: string
  }
  enabled?: boolean
  timeout?: number
}

export type McpOAuthConfig = {
  clientId?: string
  clientSecret?: string
  scope?: string
  callbackPort?: number
  redirectUri?: string
}

export type McpRemoteConfig = {
  type: "remote"
  url: string
  enabled?: boolean
  headers?: {
    [key: string]: string
  }
  oauth?: McpOAuthConfig | false
  timeout?: number
}

export type LayoutConfig = "auto" | "stretch"

export type ImageAttachmentConfig = {
  auto_resize?: boolean
  max_width?: number
  max_height?: number
  max_base64_bytes?: number
}

export type AttachmentConfig = {
  image?: ImageAttachmentConfig
}

export type ConfigV2ReferenceGit = {
  repository: string
  branch?: string
  description?: string
  hidden?: boolean
}

export type ConfigV2ReferenceLocal = {
  path: string
  description?: string
  hidden?: boolean
}

export type PolicyEffect = "allow" | "deny"

export type ConfigV2ExperimentalPolicy = {
  action: "provider.use"
  effect: PolicyEffect
  resource: string
}

export type Config = {
  $schema?: string
  shell?: string
  logLevel?: LogLevel
  server?: ServerConfig
  command?: {
    [key: string]: {
      template: string
      description?: string
      agent?: string
      model?: string
      variant?: string
      subtask?: boolean
    }
  }
  skills?: {
    paths?: Array<string>
    urls?: Array<string>
  }
  references?: {
    [key: string]: string | ConfigV2ReferenceGit | ConfigV2ReferenceLocal
  }
  reference?: {
    [key: string]: string | ConfigV2ReferenceGit | ConfigV2ReferenceLocal
  }
  watcher?: {
    ignore?: Array<string>
  }
  snapshot?: boolean
  plugin?: Array<
    | string
    | [
        string,
        {
          [key: string]: unknown
        },
      ]
  >
  share?: "manual" | "auto" | "disabled"
  autoshare?: boolean
  autoupdate?: boolean | "notify"
  disabled_providers?: Array<string>
  enabled_providers?: Array<string>
  model?: string
  small_model?: string
  default_agent?: string
  username?: string
  mode?: {
    build?: AgentConfig
    plan?: AgentConfig
    [key: string]: AgentConfig | undefined
  }
  agent?: {
    plan?: AgentConfig
    build?: AgentConfig
    general?: AgentConfig
    explore?: AgentConfig
    title?: AgentConfig
    summary?: AgentConfig
    compaction?: AgentConfig
    [key: string]: AgentConfig | undefined
  }
  provider?: {
    [key: string]: ProviderConfig
  }
  mcp?: {
    [key: string]:
      | McpLocalConfig
      | McpRemoteConfig
      | {
          enabled: boolean
        }
  }
  formatter?:
    | boolean
    | {
        [key: string]: {
          disabled?: boolean
          command?: Array<string>
          environment?: {
            [key: string]: string
          }
          extensions?: Array<string>
        }
      }
  lsp?:
    | boolean
    | {
        [key: string]:
          | {
              disabled: true
            }
          | {
              command: Array<string>
              extensions?: Array<string>
              disabled?: boolean
              env?: {
                [key: string]: string
              }
              initialization?: {
                [key: string]: unknown
              }
            }
      }
  instructions?: Array<string>
  layout?: LayoutConfig
  permission?: PermissionConfig
  tools?: {
    [key: string]: boolean
  }
  attachment?: AttachmentConfig
  enterprise?: {
    url?: string
  }
  tool_output?: {
    max_lines?: number
    max_bytes?: number
  }
  compaction?: {
    auto?: boolean
    prune?: boolean
    tail_turns?: number
    preserve_recent_tokens?: number
    reserved?: number
  }
  experimental?: {
    disable_paste_summary?: boolean
    batch_tool?: boolean
    openTelemetry?: boolean
    primary_tools?: Array<string>
    continue_loop_on_deny?: boolean
    mcp_timeout?: number
    policies?: Array<ConfigV2ExperimentalPolicy>
  }
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export type ToolListItem = {
  id: string
  description: string
  parameters: unknown
}

export type ToolList = Array<ToolListItem>

export type ToolIds = Array<string>

export type LlmProviderMetadata = {
  [key: string]: {
    [key: string]: unknown
  }
}

export type ToolTextContent = {
  type: "text"
  text: string
}

export type ToolFileContent = {
  type: "file"
  uri: string
  mime: string
  name?: string
}

export type LlmToolContent = ToolTextContent | ToolFileContent

// ─── Commands ─────────────────────────────────────────────────────────────────

export type Command = {
  name: string
  description?: string
  agent?: string
  model?: string
  source?: "command" | "mcp" | "skill"
  template: string
  subtask?: boolean
  hints: Array<string>
}

export type CommandV2Info = {
  name: string
  template: string
  description?: string
  agent?: string
  model?: ModelRef
  subtask?: boolean
}

// ─── Skills ───────────────────────────────────────────────────────────────────

export type SkillV2Info = {
  name: string
  description?: string
  slash?: boolean
  location: string
  content: string
}

export type SkillV2DirectorySource = {
  type: "directory"
  path: string
}

export type SkillV2UrlSource = {
  type: "url"
  url: string
}

export type SkillV2EmbeddedSource = {
  type: "embedded"
  skill: SkillV2Info
}

export type SkillV2Source = SkillV2DirectorySource | SkillV2UrlSource | SkillV2EmbeddedSource

// ─── References ───────────────────────────────────────────────────────────────

export type ReferenceLocalSource = {
  type: "local"
  path: string
  description?: string
  hidden?: boolean
}

export type ReferenceGitSource = {
  type: "git"
  repository: string
  branch?: string
  description?: string
  hidden?: boolean
}

export type ReferenceSource = ReferenceLocalSource | ReferenceGitSource

export type ReferenceInfo = {
  name: string
  path: string
  description?: string
  hidden?: boolean
  source: ReferenceSource
}

// ─── Permissions ──────────────────────────────────────────────────────────────

export type PermissionV2Source = {
  type: "tool"
  messageID: string
  callID: string
}

export type PermissionV2Reply = "once" | "always" | "reject"

export type PermissionV2Request = {
  id: string
  sessionID: string
  action: string
  resources: Array<string>
  save?: Array<string>
  metadata?: {
    [key: string]: unknown
  }
  source?: PermissionV2Source
}

export type PermissionSavedInfo = {
  id: string
  projectID: string
  action: string
  resource: string
}

export type PermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns: Array<string>
  metadata: {
    [key: string]: unknown
  }
  always: Array<string>
  tool?: {
    messageID: string
    callID: string
  }
}

// ─── Questions ────────────────────────────────────────────────────────────────

export type QuestionOption = {
  label: string
  description: string
}

export type QuestionInfo = {
  question: string
  header: string
  options: Array<QuestionOption>
  multiple?: boolean
  custom?: boolean
}

export type QuestionTool = {
  messageID: string
  callID: string
}

export type QuestionAnswer = Array<string>

export type QuestionRequest = {
  id: string
  sessionID: string
  questions: Array<QuestionInfo>
  tool?: QuestionTool
}

export type QuestionV2Option = {
  label: string
  description: string
}

export type QuestionV2Info = {
  question: string
  header: string
  options: Array<QuestionV2Option>
  multiple?: boolean
  custom?: boolean
}

export type QuestionV2Tool = {
  messageID: string
  callID: string
}

export type QuestionV2Answer = Array<string>

export type QuestionV2Request = {
  id: string
  sessionID: string
  questions: Array<QuestionV2Info>
  tool?: QuestionV2Tool
}

export type QuestionV2Reply = {
  answers: Array<QuestionV2Answer>
}

export type QuestionReplied = {
  sessionID: string
  requestID: string
  answers: Array<QuestionAnswer>
}

export type QuestionRejected = {
  sessionID: string
  requestID: string
}

// ─── Todo ─────────────────────────────────────────────────────────────────────

export type Todo = {
  content: string
  status: string
  priority: string
}

// ─── PTY ──────────────────────────────────────────────────────────────────────

export type Pty = {
  id: string
  title: string
  command: string
  args: Array<string>
  cwd: string
  status: "running" | "exited"
  pid: number
  exitCode?: number
}

export type PtyTicketConnectToken = {
  ticket: string
  expires_in: number
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export type ProjectVcs = "git"

export type ProjectIcon = {
  url?: string
  override?: string
  color?: string
}

export type ProjectCommands = {
  start?: string
}

export type ProjectTime = {
  created: number
  updated: number
  initialized?: number
}

export type Project = {
  id: string
  worktree: string
  vcs?: ProjectVcs
  name?: string
  icon?: ProjectIcon
  commands?: ProjectCommands
  time: ProjectTime
  sandboxes: Array<string>
}

export type ProjectSummary = {
  id: string
  name?: string
  worktree: string
}

export type ProjectDirectories = Array<{
  directory: string
  strategy?: string
}>

// ─── Worktrees ────────────────────────────────────────────────────────────────

export type WorktreeCreateInput = {
  name?: string
  startCommand?: string
}

export type Worktree = {
  name: string
  branch?: string
  directory: string
}

export type WorktreeRemoveInput = {
  directory: string
}

export type WorktreeResetInput = {
  directory: string
}

// ─── Workspaces ───────────────────────────────────────────────────────────────

export type Workspace = {
  id: string
  type: string
  name: string
  branch?: string | null
  directory?: string | null
  extra?: unknown | null
  projectID: string
  timeUsed: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
}

export type WorkspaceEventConnectionStatus = {
  workspaceID: string
  status: "connected" | "connecting" | "disconnected" | "error"
}

// ─── Integrations ─────────────────────────────────────────────────────────────

export type IntegrationWhen = {
  key: string
  op: "eq" | "neq"
  value: string
}

export type IntegrationTextPrompt = {
  type: "text"
  key: string
  message: string
  placeholder?: string
  when?: IntegrationWhen
}

export type IntegrationSelectPrompt = {
  type: "select"
  key: string
  message: string
  options: Array<{
    label: string
    value: string
    hint?: string
  }>
  when?: IntegrationWhen
}

export type IntegrationOAuthMethod = {
  id: string
  type: "oauth"
  label: string
  prompts?: Array<IntegrationTextPrompt | IntegrationSelectPrompt>
}

export type IntegrationKeyMethod = {
  type: "key"
  label?: string
}

export type IntegrationEnvMethod = {
  type: "env"
  names: Array<string>
}

export type IntegrationMethod = IntegrationOAuthMethod | IntegrationKeyMethod | IntegrationEnvMethod

export type IntegrationRef = {
  id: string
  name: string
}

export type ConnectionCredentialInfo = {
  type: "credential"
  id: string
  label: string
}

export type ConnectionEnvInfo = {
  type: "env"
  name: string
}

export type ConnectionInfo = ConnectionCredentialInfo | ConnectionEnvInfo

export type IntegrationInfo = {
  id: string
  name: string
  methods: Array<IntegrationMethod>
  connections: Array<ConnectionInfo>
}

export type IntegrationAttempt = {
  attemptID: string
  url: string
  instructions: string
  mode: "auto" | "code"
  time: {
    created: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
    expires: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
  }
}

export type IntegrationAttemptStatus =
  | {
      status: "pending"
      time: {
        created: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
        expires: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      }
    }
  | {
      status: "complete"
      time: {
        created: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
        expires: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      }
    }
  | {
      status: "failed"
      message: string
      time: {
        created: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
        expires: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      }
    }
  | {
      status: "expired"
      time: {
        created: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
        expires: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      }
    }

export type IntegrationInputs = {
  [key: string]: string
}

// ─── MCP ──────────────────────────────────────────────────────────────────────

export type McpResource = {
  name: string
  uri: string
  description?: string
  mimeType?: string
  client: string
}

export type McpStatusConnected = {
  status: "connected"
}

export type McpStatusDisabled = {
  status: "disabled"
}

export type McpStatusFailed = {
  status: "failed"
  error: string
}

export type McpStatusNeedsAuth = {
  status: "needs_auth"
}

export type McpStatusNeedsClientRegistration = {
  status: "needs_client_registration"
  error: string
}

export type McpStatus =
  | McpStatusConnected
  | McpStatusDisabled
  | McpStatusFailed
  | McpStatusNeedsAuth
  | McpStatusNeedsClientRegistration

// ─── LSP & Formatter ──────────────────────────────────────────────────────────

export type LspStatus = {
  id: string
  name: string
  root: string
  status: "connected" | "error"
}

export type FormatterStatus = {
  name: string
  extensions: Array<string>
  enabled: boolean
}

// ─── VCS ──────────────────────────────────────────────────────────────────────

export type VcsInfo = {
  branch?: string
  default_branch?: string
}

export type VcsFileStatus = {
  file: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
}

export type VcsFileDiff = {
  file: string
  patch?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

// ─── File system ─────────────────────────────────────────────────────────────

export type Symbol = {
  name: string
  kind: number
  location: {
    uri: string
    range: Range
  }
}

export type FileNode = {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
}

export type FileContent = {
  type: "text" | "binary"
  content: string
  diff?: string
  patch?: {
    oldFileName: string
    newFileName: string
    oldHeader?: string
    newHeader?: string
    hunks: Array<{
      oldStart: number
      oldLines: number
      newStart: number
      newLines: number
      lines: Array<string>
    }>
    index?: string
  }
  encoding?: "base64"
  mimeType?: string
}

export type File = {
  path: string
  added: number
  removed: number
  status: "added" | "deleted" | "modified"
}

export type FileSystemEntry = {
  path: string
  type: "file" | "directory"
}

export type Path = {
  home: string
  state: string
  config: string
  worktree: string
  directory: string
}

// ─── Capabilities ────────────────────────────────────────────────────────────

export type ExperimentalCapabilities = {
  backgroundSubagents: boolean
}

export type ConsoleState = {
  consoleManagedProviders: Array<string>
  activeOrgName?: string
  switchableOrgCount: number
}

// ─── Experimental responses ──────────────────────────────────────────────────

export type ExperimentalConsoleListOrgsResponses = {
  200: {
    orgs: Array<{
      accountID: string
      accountEmail: string
      accountUrl: string
      orgID: string
      orgName: string
      active: boolean
    }>
  }
}

export type ExperimentalConsoleListOrgsResponse =
  ExperimentalConsoleListOrgsResponses[keyof ExperimentalConsoleListOrgsResponses]

export type ExperimentalWorkspaceAdapterListResponses = {
  200: Array<{
    type: string
    name: string
    description: string
  }>
}

export type ExperimentalWorkspaceAdapterListResponse =
  ExperimentalWorkspaceAdapterListResponses[keyof ExperimentalWorkspaceAdapterListResponses]

// ─── Session messages (V2 API) ────────────────────────────────────────────────

export type SessionMessageAgentSwitched = {
  id: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    created: number
  }
  type: "agent-switched"
  agent: string
}

export type SessionMessageModelSwitched = {
  id: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    created: number
  }
  type: "model-switched"
  model: ModelRef
}

export type SessionMessageUser = {
  id: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    created: number
  }
  text: string
  files?: Array<PromptFileAttachment>
  agents?: Array<PromptAgentAttachment>
  type: "user"
}

export type SessionMessageSynthetic = {
  id: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    created: number
  }
  sessionID: string
  text: string
  type: "synthetic"
}

export type SessionMessageSystem = {
  id: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    created: number
  }
  type: "system"
  text: string
}

export type SessionMessageShell = {
  id: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    created: number
    completed?: number
  }
  type: "shell"
  callID: string
  command: string
  output: string
}

export type SessionMessageAssistantText = {
  type: "text"
  id: string
  text: string
}

export type SessionMessageAssistantReasoning = {
  type: "reasoning"
  id: string
  text: string
  providerMetadata?: LlmProviderMetadata
  time?: {
    created: number
    completed?: number
  }
}

export type SessionMessageToolStatePending = {
  status: "pending"
  input: string
}

export type SessionMessageToolStateRunning = {
  status: "running"
  input: {
    [key: string]: unknown
  }
  structured: {
    [key: string]: unknown
  }
  content: Array<LlmToolContent>
}

export type SessionMessageToolStateCompleted = {
  status: "completed"
  input: {
    [key: string]: unknown
  }
  attachments?: Array<PromptFileAttachment>
  content: Array<LlmToolContent>
  outputPaths?: Array<string>
  structured: {
    [key: string]: unknown
  }
  result?: unknown
}

export type SessionMessageToolStateError = {
  status: "error"
  input: {
    [key: string]: unknown
  }
  content: Array<LlmToolContent>
  structured: {
    [key: string]: unknown
  }
  error: SessionErrorUnknown
  result?: unknown
}

export type SessionMessageAssistantTool = {
  type: "tool"
  id: string
  name: string
  provider?: {
    executed: boolean
    metadata?: LlmProviderMetadata
    resultMetadata?: LlmProviderMetadata
  }
  state:
    | SessionMessageToolStatePending
    | SessionMessageToolStateRunning
    | SessionMessageToolStateCompleted
    | SessionMessageToolStateError
  time: {
    created: number
    ran?: number
    completed?: number
    pruned?: number
  }
}

export type SessionMessageAssistant = {
  id: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    created: number
    completed?: number
  }
  type: "assistant"
  agent: string
  model: ModelRef
  content: Array<SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool>
  snapshot?: {
    start?: string
    end?: string
    files?: Array<string>
  }
  finish?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  error?: SessionErrorUnknown
}

export type SessionMessageCompaction = {
  type: "compaction"
  reason: "auto" | "manual"
  summary: string
  recent: string
  id: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    created: number
  }
}

export type SessionMessage =
  | SessionMessageAgentSwitched
  | SessionMessageModelSwitched
  | SessionMessageUser
  | SessionMessageSynthetic
  | SessionMessageSystem
  | SessionMessageShell
  | SessionMessageAssistant
  | SessionMessageCompaction

// ─── Session History ──────────────────────────────────────────────────────────

export type SessionHistory = {
  data: Array<V2Event>
  hasMore: boolean
}

export type MessageWithParts = {
  info: Message
  parts: Array<Part>
}

export type ProjectCopyCopy = {
  directory: string
}

export type VcsDiffResponses = {
  200: Array<VcsFileDiff>
}

export type VcsDiffResponse = VcsDiffResponses[keyof VcsDiffResponses]

// ─── Location ─────────────────────────────────────────────────────────────────

export type LocationInfo = {
  directory: string
  workspaceID?: string
  project: {
    id: string
    directory: string
  }
}

// ─── MoveSession ──────────────────────────────────────────────────────────────

export type MoveSessionDestination = {
  directory: string
}

// ─── Events (GlobalEvent format used by sdk.global.event SSE) ─────────────────

export type GlobalEvent = {
  directory: string
  project?: string
  workspace?: string
  payload:
    | {
        id: string
        type: "models-dev.refreshed"
        properties: {
          [key: string]: unknown
        }
      }
    | {
        id: string
        type: "integration.updated"
        properties: {
          [key: string]: unknown
        }
      }
    | {
        id: string
        type: "integration.connection.updated"
        properties: {
          integrationID: string
        }
      }
    | {
        id: string
        type: "catalog.updated"
        properties: {
          [key: string]: unknown
        }
      }
    | {
        id: string
        type: "session.created"
        properties: {
          sessionID: string
          info: Session
        }
      }
    | {
        id: string
        type: "session.updated"
        properties: {
          sessionID: string
          info: Session
        }
      }
    | {
        id: string
        type: "session.deleted"
        properties: {
          sessionID: string
          info: Session
        }
      }
    | {
        id: string
        type: "message.updated"
        properties: {
          sessionID: string
          info: Message
        }
      }
    | {
        id: string
        type: "message.removed"
        properties: {
          sessionID: string
          messageID: string
        }
      }
    | {
        id: string
        type: "message.part.updated"
        properties: {
          sessionID: string
          part: Part
          time: number
        }
      }
    | {
        id: string
        type: "message.part.removed"
        properties: {
          sessionID: string
          messageID: string
          partID: string
        }
      }
    | {
        id: string
        type: "session.next.agent.switched"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          agent: string
        }
      }
    | {
        id: string
        type: "session.next.model.switched"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          model: ModelRef
        }
      }
    | {
        id: string
        type: "session.next.moved"
        properties: {
          timestamp: number
          sessionID: string
          location: LocationRef
          subdirectory?: string
        }
      }
    | {
        id: string
        type: "session.next.prompted"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          prompt: Prompt
          delivery: "steer" | "queue"
        }
      }
    | {
        id: string
        type: "session.next.prompt.admitted"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          prompt: Prompt
          delivery: "steer" | "queue"
        }
      }
    | {
        id: string
        type: "session.next.context.updated"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          text: string
        }
      }
    | {
        id: string
        type: "session.next.synthetic"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          text: string
        }
      }
    | {
        id: string
        type: "session.next.shell.started"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          callID: string
          command: string
        }
      }
    | {
        id: string
        type: "session.next.shell.ended"
        properties: {
          timestamp: number
          sessionID: string
          callID: string
          output: string
        }
      }
    | {
        id: string
        type: "session.next.step.started"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          agent: string
          model: ModelRef
          snapshot?: string
        }
      }
    | {
        id: string
        type: "session.next.step.ended"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          finish: string
          cost: number
          tokens: {
            input: number
            output: number
            reasoning: number
            cache: {
              read: number
              write: number
            }
          }
          snapshot?: string
          files?: Array<string>
        }
      }
    | {
        id: string
        type: "session.next.step.failed"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          error: SessionErrorUnknown
        }
      }
    | {
        id: string
        type: "session.next.text.started"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          textID: string
        }
      }
    | {
        id: string
        type: "session.next.text.delta"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          textID: string
          delta: string
        }
      }
    | {
        id: string
        type: "session.next.text.ended"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          textID: string
          text: string
        }
      }
    | {
        id: string
        type: "session.next.reasoning.started"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          reasoningID: string
          providerMetadata?: LlmProviderMetadata
        }
      }
    | {
        id: string
        type: "session.next.reasoning.delta"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          reasoningID: string
          delta: string
        }
      }
    | {
        id: string
        type: "session.next.reasoning.ended"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          reasoningID: string
          text: string
          providerMetadata?: LlmProviderMetadata
        }
      }
    | {
        id: string
        type: "session.next.tool.input.started"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          callID: string
          name: string
        }
      }
    | {
        id: string
        type: "session.next.tool.input.delta"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          callID: string
          delta: string
        }
      }
    | {
        id: string
        type: "session.next.tool.input.ended"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          callID: string
          text: string
        }
      }
    | {
        id: string
        type: "session.next.tool.called"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          callID: string
          tool: string
          input: {
            [key: string]: unknown
          }
          provider: {
            executed: boolean
            metadata?: LlmProviderMetadata
          }
        }
      }
    | {
        id: string
        type: "session.next.tool.progress"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          callID: string
          structured: {
            [key: string]: unknown
          }
          content: Array<LlmToolContent>
        }
      }
    | {
        id: string
        type: "session.next.tool.success"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          callID: string
          structured: {
            [key: string]: unknown
          }
          content: Array<LlmToolContent>
          outputPaths?: Array<string>
          result?: unknown
          provider: {
            executed: boolean
            metadata?: LlmProviderMetadata
          }
        }
      }
    | {
        id: string
        type: "session.next.tool.failed"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          callID: string
          error: SessionErrorUnknown
          result?: unknown
          provider: {
            executed: boolean
            metadata?: LlmProviderMetadata
          }
        }
      }
    | {
        id: string
        type: "session.next.retried"
        properties: {
          timestamp: number
          sessionID: string
          attempt: number
          error: SessionNextRetryError
        }
      }
    | {
        id: string
        type: "session.next.compaction.started"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          reason: "auto" | "manual"
        }
      }
    | {
        id: string
        type: "session.next.compaction.delta"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          text: string
        }
      }
    | {
        id: string
        type: "session.next.compaction.ended"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          reason: "auto" | "manual"
          text: string
          recent: string
        }
      }
    | {
        id: string
        type: "session.next.revert.staged"
        properties: {
          timestamp: number
          sessionID: string
          revert: RevertState
        }
      }
    | {
        id: string
        type: "session.next.revert.cleared"
        properties: {
          timestamp: number
          sessionID: string
        }
      }
    | {
        id: string
        type: "session.next.revert.committed"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
        }
      }
    | {
        id: string
        type: "message.part.delta"
        properties: {
          sessionID: string
          messageID: string
          partID: string
          field: string
          delta: string
        }
      }
    | {
        id: string
        type: "session.diff"
        properties: {
          sessionID: string
          diff: Array<SnapshotFileDiff>
        }
      }
    | {
        id: string
        type: "session.error"
        properties: {
          sessionID?: string
          error?:
            | ProviderAuthError
            | UnknownError
            | MessageOutputLengthError
            | MessageAbortedError
            | StructuredOutputError
            | ContextOverflowError
            | ContentFilterError
            | ApiError
        }
      }
    | {
        id: string
        type: "installation.updated"
        properties: {
          version: string
        }
      }
    | {
        id: string
        type: "installation.update-available"
        properties: {
          version: string
        }
      }
    | {
        id: string
        type: "file.edited"
        properties: {
          file: string
        }
      }
    | {
        id: string
        type: "reference.updated"
        properties: {
          [key: string]: unknown
        }
      }
    | {
        id: string
        type: "permission.v2.asked"
        properties: {
          id: string
          sessionID: string
          action: string
          resources: Array<string>
          save?: Array<string>
          metadata?: {
            [key: string]: unknown
          }
          source?: PermissionV2Source
        }
      }
    | {
        id: string
        type: "permission.v2.replied"
        properties: {
          sessionID: string
          requestID: string
          reply: PermissionV2Reply
        }
      }
    | {
        id: string
        type: "plugin.added"
        properties: {
          id: string
        }
      }
    | {
        id: string
        type: "project.directories.updated"
        properties: {
          projectID: string
        }
      }
    | {
        id: string
        type: "file.watcher.updated"
        properties: {
          file: string
          event: "add" | "change" | "unlink"
        }
      }
    | {
        id: string
        type: "pty.created"
        properties: {
          info: Pty
        }
      }
    | {
        id: string
        type: "pty.updated"
        properties: {
          info: Pty
        }
      }
    | {
        id: string
        type: "pty.exited"
        properties: {
          id: string
          exitCode: number
        }
      }
    | {
        id: string
        type: "pty.deleted"
        properties: {
          id: string
        }
      }
    | {
        id: string
        type: "question.v2.asked"
        properties: {
          id: string
          sessionID: string
          questions: Array<QuestionV2Info>
          tool?: QuestionV2Tool
        }
      }
    | {
        id: string
        type: "question.v2.replied"
        properties: {
          sessionID: string
          requestID: string
          answers: Array<QuestionV2Answer>
        }
      }
    | {
        id: string
        type: "question.v2.rejected"
        properties: {
          sessionID: string
          requestID: string
        }
      }
    | {
        id: string
        type: "todo.updated"
        properties: {
          sessionID: string
          todos: Array<Todo>
        }
      }
    | {
        id: string
        type: "lsp.updated"
        properties: {
          [key: string]: unknown
        }
      }
    | {
        id: string
        type: "permission.asked"
        properties: {
          id: string
          sessionID: string
          permission: string
          patterns: Array<string>
          metadata: {
            [key: string]: unknown
          }
          always: Array<string>
          tool?: {
            messageID: string
            callID: string
          }
        }
      }
    | {
        id: string
        type: "permission.replied"
        properties: {
          sessionID: string
          requestID: string
          reply: "once" | "always" | "reject"
        }
      }
    | {
        id: string
        type: "tui.prompt.append"
        properties: {
          text: string
        }
      }
    | {
        id: string
        type: "tui.command.execute"
        properties: {
          command:
            | "session.list"
            | "session.new"
            | "session.share"
            | "session.interrupt"
            | "session.compact"
            | "session.page.up"
            | "session.page.down"
            | "session.line.up"
            | "session.line.down"
            | "session.half.page.up"
            | "session.half.page.down"
            | "session.first"
            | "session.last"
            | "prompt.clear"
            | "prompt.submit"
            | "agent.cycle"
            | string
        }
      }
    | {
        id: string
        type: "tui.toast.show"
        properties: {
          title?: string
          message: string
          variant: "info" | "success" | "warning" | "error"
          duration?: number
        }
      }
    | {
        id: string
        type: "tui.session.select"
        properties: {
          sessionID: string
        }
      }
    | {
        id: string
        type: "mcp.tools.changed"
        properties: {
          server: string
        }
      }
    | {
        id: string
        type: "mcp.browser.open.failed"
        properties: {
          mcpName: string
          url: string
        }
      }
    | {
        id: string
        type: "command.executed"
        properties: {
          name: string
          sessionID: string
          arguments: string
          messageID: string
        }
      }
    | {
        id: string
        type: "project.updated"
        properties: {
          id: string
          worktree: string
          vcs?: ProjectVcs
          name?: string
          icon?: ProjectIcon
          commands?: ProjectCommands
          time: ProjectTime
          sandboxes: Array<string>
        }
      }
    | {
        id: string
        type: "session.status"
        properties: {
          sessionID: string
          status: SessionStatus
        }
      }
    | {
        id: string
        type: "session.idle"
        properties: {
          sessionID: string
        }
      }
    | {
        id: string
        type: "question.asked"
        properties: {
          id: string
          sessionID: string
          questions: Array<QuestionInfo>
          tool?: QuestionTool
        }
      }
    | {
        id: string
        type: "question.replied"
        properties: {
          sessionID: string
          requestID: string
          answers: Array<QuestionAnswer>
        }
      }
    | {
        id: string
        type: "question.rejected"
        properties: {
          sessionID: string
          requestID: string
        }
      }
    | {
        id: string
        type: "session.compacted"
        properties: {
          sessionID: string
        }
      }
    | {
        id: string
        type: "vcs.branch.updated"
        properties: {
          branch?: string
        }
      }
    | {
        id: string
        type: "workspace.ready"
        properties: {
          name: string
        }
      }
    | {
        id: string
        type: "workspace.failed"
        properties: {
          message: string
        }
      }
    | {
        id: string
        type: "workspace.status"
        properties: {
          workspaceID: string
          status: "connected" | "connecting" | "disconnected" | "error"
        }
      }
    | {
        id: string
        type: "worktree.ready"
        properties: {
          name: string
          branch?: string
        }
      }
    | {
        id: string
        type: "worktree.failed"
        properties: {
          message: string
        }
      }
    | {
        id: string
        type: "server.connected"
        properties: {
          [key: string]: unknown
        }
      }
    | {
        id: string
        type: "global.disposed"
        properties: {
          [key: string]: unknown
        }
      }
    | {
        id: string
        type: "server.instance.disposed"
        properties: {
          directory: string
        }
      }
    | {
        type: "sync"
        id: string
        syncEvent: {
          type: string
          id: string
          seq: number
          aggregateID: string
          data: unknown
        }
      }
}

// Extract the payload union as the "Event" type (what event.ts uses)
export type Event = GlobalEvent["payload"]

// ─── V2 Event (structured event from the V2 API) ──────────────────────────────

export type V2Event =
  | {
      id: string
      type: "models-dev.refreshed"
      location?: LocationRef
      data: { [key: string]: unknown }
    }
  | {
      id: string
      type: "integration.updated"
      location?: LocationRef
      data: { [key: string]: unknown }
    }
  | {
      id: string
      type: "integration.connection.updated"
      location?: LocationRef
      data: { integrationID: string }
    }
  | {
      id: string
      type: "catalog.updated"
      location?: LocationRef
      data: { [key: string]: unknown }
    }
  | {
      id: string
      type: "session.created"
      location?: LocationRef
      data: { sessionID: string; info: Session }
    }
  | {
      id: string
      type: "session.updated"
      location?: LocationRef
      data: { sessionID: string; info: Session }
    }
  | {
      id: string
      type: "session.deleted"
      location?: LocationRef
      data: { sessionID: string; info: Session }
    }
  | {
      id: string
      type: "message.updated"
      location?: LocationRef
      data: { sessionID: string; info: Message }
    }
  | {
      id: string
      type: "message.removed"
      location?: LocationRef
      data: { sessionID: string; messageID: string }
    }
  | {
      id: string
      type: "message.part.updated"
      location?: LocationRef
      data: { sessionID: string; part: Part; time: number }
    }
  | {
      id: string
      type: "message.part.removed"
      location?: LocationRef
      data: { sessionID: string; messageID: string; partID: string }
    }
  | {
      id: string
      type: "session.next.agent.switched"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; messageID: string; agent: string }
    }
  | {
      id: string
      type: "session.next.model.switched"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; messageID: string; model: ModelRef }
    }
  | {
      id: string
      type: "session.next.moved"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; location: LocationRef; subdirectory?: string }
    }
  | {
      id: string
      type: "session.next.prompted"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; messageID: string; prompt: Prompt; delivery: "steer" | "queue" }
    }
  | {
      id: string
      type: "session.next.prompt.admitted"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; messageID: string; prompt: Prompt; delivery: "steer" | "queue" }
    }
  | {
      id: string
      type: "session.next.context.updated"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; messageID: string; text: string }
    }
  | {
      id: string
      type: "session.next.synthetic"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; messageID: string; text: string }
    }
  | {
      id: string
      type: "session.next.shell.started"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; messageID: string; callID: string; command: string }
    }
  | {
      id: string
      type: "session.next.shell.ended"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; callID: string; output: string }
    }
  | {
      id: string
      type: "session.next.step.started"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; assistantMessageID: string; agent: string; model: ModelRef; snapshot?: string }
    }
  | {
      id: string
      type: "session.next.step.ended"
      location?: LocationRef
      data: {
        timestamp: number
        sessionID: string
        assistantMessageID: string
        finish: string
        cost: number
        tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
        snapshot?: string
        files?: Array<string>
      }
    }
  | {
      id: string
      type: "session.next.step.failed"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; assistantMessageID: string; error: SessionErrorUnknown }
    }
  | {
      id: string
      type: "session.next.text.started"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; assistantMessageID: string; textID: string }
    }
  | {
      id: string
      type: "session.next.text.delta"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; assistantMessageID: string; textID: string; delta: string }
    }
  | {
      id: string
      type: "session.next.text.ended"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; assistantMessageID: string; textID: string; text: string }
    }
  | {
      id: string
      type: "session.next.reasoning.started"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; assistantMessageID: string; reasoningID: string; providerMetadata?: LlmProviderMetadata }
    }
  | {
      id: string
      type: "session.next.reasoning.delta"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; assistantMessageID: string; reasoningID: string; delta: string }
    }
  | {
      id: string
      type: "session.next.reasoning.ended"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; assistantMessageID: string; reasoningID: string; text: string; providerMetadata?: LlmProviderMetadata }
    }
  | {
      id: string
      type: "session.next.tool.input.started"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; assistantMessageID: string; callID: string; name: string }
    }
  | {
      id: string
      type: "session.next.tool.input.delta"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; assistantMessageID: string; callID: string; delta: string }
    }
  | {
      id: string
      type: "session.next.tool.input.ended"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; assistantMessageID: string; callID: string; text: string }
    }
  | {
      id: string
      type: "session.next.tool.called"
      location?: LocationRef
      data: {
        timestamp: number
        sessionID: string
        assistantMessageID: string
        callID: string
        tool: string
        input: { [key: string]: unknown }
        provider: { executed: boolean; metadata?: LlmProviderMetadata }
      }
    }
  | {
      id: string
      type: "session.next.tool.progress"
      location?: LocationRef
      data: {
        timestamp: number
        sessionID: string
        assistantMessageID: string
        callID: string
        structured: { [key: string]: unknown }
        content: Array<LlmToolContent>
      }
    }
  | {
      id: string
      type: "session.next.tool.success"
      location?: LocationRef
      data: {
        timestamp: number
        sessionID: string
        assistantMessageID: string
        callID: string
        structured: { [key: string]: unknown }
        content: Array<LlmToolContent>
        outputPaths?: Array<string>
        result?: unknown
        provider: { executed: boolean; metadata?: LlmProviderMetadata }
      }
    }
  | {
      id: string
      type: "session.next.tool.failed"
      location?: LocationRef
      data: {
        timestamp: number
        sessionID: string
        assistantMessageID: string
        callID: string
        error: SessionErrorUnknown
        result?: unknown
        provider: { executed: boolean; metadata?: LlmProviderMetadata }
      }
    }
  | {
      id: string
      type: "session.next.retried"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; attempt: number; error: SessionNextRetryError }
    }
  | {
      id: string
      type: "session.next.compaction.started"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; messageID: string; reason: "auto" | "manual" }
    }
  | {
      id: string
      type: "session.next.compaction.delta"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; messageID: string; text: string }
    }
  | {
      id: string
      type: "session.next.compaction.ended"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; messageID: string; reason: "auto" | "manual"; text: string; recent: string }
    }
  | {
      id: string
      type: "session.next.revert.staged"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; revert: RevertState }
    }
  | {
      id: string
      type: "session.next.revert.cleared"
      location?: LocationRef
      data: { timestamp: number; sessionID: string }
    }
  | {
      id: string
      type: "session.next.revert.committed"
      location?: LocationRef
      data: { timestamp: number; sessionID: string; messageID: string }
    }
  | {
      id: string
      type: "message.part.delta"
      location?: LocationRef
      data: { sessionID: string; messageID: string; partID: string; field: string; delta: string }
    }
  | {
      id: string
      type: "session.diff"
      location?: LocationRef
      data: { sessionID: string; diff: Array<SnapshotFileDiff> }
    }
  | {
      id: string
      type: "session.error"
      location?: LocationRef
      data: {
        sessionID?: string
        error?: ProviderAuthError | UnknownError | MessageOutputLengthError | MessageAbortedError | StructuredOutputError | ContextOverflowError | ContentFilterError | ApiError
      }
    }
  | {
      id: string
      type: "installation.updated"
      location?: LocationRef
      data: { version: string }
    }
  | {
      id: string
      type: "installation.update-available"
      location?: LocationRef
      data: { version: string }
    }
  | {
      id: string
      type: "file.edited"
      location?: LocationRef
      data: { file: string }
    }
  | {
      id: string
      type: "reference.updated"
      location?: LocationRef
      data: { [key: string]: unknown }
    }
  | {
      id: string
      type: "permission.v2.asked"
      location?: LocationRef
      data: {
        id: string
        sessionID: string
        action: string
        resources: Array<string>
        save?: Array<string>
        metadata?: { [key: string]: unknown }
        source?: PermissionV2Source
      }
    }
  | {
      id: string
      type: "permission.v2.replied"
      location?: LocationRef
      data: { sessionID: string; requestID: string; reply: PermissionV2Reply }
    }
  | {
      id: string
      type: "plugin.added"
      location?: LocationRef
      data: { id: string }
    }
  | {
      id: string
      type: "project.directories.updated"
      location?: LocationRef
      data: { projectID: string }
    }
  | {
      id: string
      type: "file.watcher.updated"
      location?: LocationRef
      data: { file: string; event: "add" | "change" | "unlink" }
    }
  | {
      id: string
      type: "pty.created"
      location?: LocationRef
      data: { info: Pty }
    }
  | {
      id: string
      type: "pty.updated"
      location?: LocationRef
      data: { info: Pty }
    }
  | {
      id: string
      type: "pty.exited"
      location?: LocationRef
      data: { id: string; exitCode: number }
    }
  | {
      id: string
      type: "pty.deleted"
      location?: LocationRef
      data: { id: string }
    }
  | {
      id: string
      type: "question.v2.asked"
      location?: LocationRef
      data: { id: string; sessionID: string; questions: Array<QuestionV2Info>; tool?: QuestionV2Tool }
    }
  | {
      id: string
      type: "question.v2.replied"
      location?: LocationRef
      data: { sessionID: string; requestID: string; answers: Array<QuestionV2Answer> }
    }
  | {
      id: string
      type: "question.v2.rejected"
      location?: LocationRef
      data: { sessionID: string; requestID: string }
    }
  | {
      id: string
      type: "todo.updated"
      location?: LocationRef
      data: { sessionID: string; todos: Array<Todo> }
    }
  | {
      id: string
      type: "lsp.updated"
      location?: LocationRef
      data: { [key: string]: unknown }
    }
  | {
      id: string
      type: "permission.asked"
      location?: LocationRef
      data: {
        id: string
        sessionID: string
        permission: string
        patterns: Array<string>
        metadata: { [key: string]: unknown }
        always: Array<string>
        tool?: { messageID: string; callID: string }
      }
    }
  | {
      id: string
      type: "permission.replied"
      location?: LocationRef
      data: { sessionID: string; requestID: string; reply: "once" | "always" | "reject" }
    }
  | {
      id: string
      type: "tui.prompt.append"
      location?: LocationRef
      data: { text: string }
    }
  | {
      id: string
      type: "tui.command.execute"
      location?: LocationRef
      data: {
        command:
          | "session.list"
          | "session.new"
          | "session.share"
          | "session.interrupt"
          | "session.compact"
          | "session.page.up"
          | "session.page.down"
          | "session.line.up"
          | "session.line.down"
          | "session.half.page.up"
          | "session.half.page.down"
          | "session.first"
          | "session.last"
          | "prompt.clear"
          | "prompt.submit"
          | "agent.cycle"
          | string
      }
    }
  | {
      id: string
      type: "tui.toast.show"
      location?: LocationRef
      data: {
        title?: string
        message: string
        variant: "info" | "success" | "warning" | "error"
        duration?: number
      }
    }
  | {
      id: string
      type: "tui.session.select"
      location?: LocationRef
      data: { sessionID: string }
    }
  | {
      id: string
      type: "mcp.tools.changed"
      location?: LocationRef
      data: { server: string }
    }
  | {
      id: string
      type: "mcp.browser.open.failed"
      location?: LocationRef
      data: { mcpName: string; url: string }
    }
  | {
      id: string
      type: "command.executed"
      location?: LocationRef
      data: { name: string; sessionID: string; arguments: string; messageID: string }
    }
  | {
      id: string
      type: "project.updated"
      location?: LocationRef
      data: { id: string; worktree: string; vcs?: ProjectVcs; name?: string; icon?: ProjectIcon; commands?: ProjectCommands; time: ProjectTime; sandboxes: Array<string> }
    }
  | {
      id: string
      type: "session.status"
      location?: LocationRef
      data: { sessionID: string; status: SessionStatus }
    }
  | {
      id: string
      type: "session.idle"
      location?: LocationRef
      data: { sessionID: string }
    }
  | {
      id: string
      type: "question.asked"
      location?: LocationRef
      data: { id: string; sessionID: string; questions: Array<QuestionInfo>; tool?: QuestionTool }
    }
  | {
      id: string
      type: "question.replied"
      location?: LocationRef
      data: { sessionID: string; requestID: string; answers: Array<QuestionAnswer> }
    }
  | {
      id: string
      type: "question.rejected"
      location?: LocationRef
      data: { sessionID: string; requestID: string }
    }
  | {
      id: string
      type: "session.compacted"
      location?: LocationRef
      data: { sessionID: string }
    }
  | {
      id: string
      type: "vcs.branch.updated"
      location?: LocationRef
      data: { branch?: string }
    }
  | {
      id: string
      type: "workspace.ready"
      location?: LocationRef
      data: { name: string }
    }
  | {
      id: string
      type: "workspace.failed"
      location?: LocationRef
      data: { message: string }
    }
  | {
      id: string
      type: "workspace.status"
      location?: LocationRef
      data: { workspaceID: string; status: "connected" | "connecting" | "disconnected" | "error" }
    }
  | {
      id: string
      type: "worktree.ready"
      location?: LocationRef
      data: { name: string; branch?: string }
    }
  | {
      id: string
      type: "worktree.failed"
      location?: LocationRef
      data: { message: string }
    }
  | {
      id: string
      type: "server.connected"
      location?: LocationRef
      data: { [key: string]: unknown }
    }
  | {
      id: string
      type: "global.disposed"
      location?: LocationRef
      data: { [key: string]: unknown }
    }
