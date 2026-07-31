// ─── Output utilities ─────────────────────────────────────────────────────────
export { color } from "./output/color.js"
export { table, truncate, pad } from "./output/table.js"
export { spinner, info, success, error, warn } from "./output/progress.js"

// ─── Formatters ───────────────────────────────────────────────────────────────
export {
  formatSessionList,
  formatSessionDetail,
} from "./formatters/session.formatter.js"
export type { SessionInfo } from "./formatters/session.formatter.js"

export {
  formatProviderList,
  formatProviderAuthStatus,
} from "./formatters/provider.formatter.js"
export type { ProviderInfo } from "./formatters/provider.formatter.js"

export {
  formatModelList,
} from "./formatters/model.formatter.js"
export type { ModelInfo } from "./formatters/model.formatter.js"

export {
  formatAgentList,
  formatAgentDetail,
} from "./formatters/agent.formatter.js"
export type { AgentInfo } from "./formatters/agent.formatter.js"

export {
  formatMcpList,
  formatMcpStatus,
} from "./formatters/mcp.formatter.js"
export type { McpServerInfo, McpServerStatus } from "./formatters/mcp.formatter.js"

export {
  formatCredentialList,
} from "./formatters/credential.formatter.js"
export type { CredentialDisplayInfo } from "./formatters/credential.formatter.js"
