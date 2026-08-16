/**
 * @gco/controller-tool
 *
 * Tool definitions and registry for the neko project.
 *
 * Re-exports all tool modules and provides the combined layer:
 *   ToolControllerLayer = ToolRegistry.layer + ToolPermissionEnforcer.layer
 */

// ─── Core types & registry ───────────────────────────────────────────────────

export {
  Tool,
  ToolFailure,
  RegistrationError,
  make,
  validateName,
  withPermission,
  permission,
  definition,
  settle,
} from "./Tool"
export type { AnyTool, ToolContext, ToolDefinition, ToolResultValue, ToolOutput, ToolCall, Content } from "./Tool"

export {
  ToolRegistry,
  Service as ToolRegistryService,
  layer as toolRegistryLayer,
} from "./ToolRegistry"
export type {
  ExecuteInput,
  Materialization,
  Settlement,
  PermissionRule,
  PermissionRuleset,
  Interface as ToolRegistryInterface,
} from "./ToolRegistry"

export {
  ToolPermissionEnforcer,
  Service as ToolPermissionEnforcerService,
  layer as toolPermissionEnforcerLayer,
} from "./ToolPermissionEnforcer"
export type { Interface as ToolPermissionEnforcerInterface } from "./ToolPermissionEnforcer"

// ─── Tool modules ────────────────────────────────────────────────────────────

export { BashTool } from "./tools/BashTool"

export { ReadTool } from "./tools/ReadTool"
export { ReadFilesystemTool } from "./tools/ReadFilesystemTool"

export { WriteTool } from "./tools/WriteTool"
export { EditTool } from "./tools/EditTool"
export { GlobTool } from "./tools/GlobTool"
export { GrepTool } from "./tools/GrepTool"
export { WebFetchTool } from "./tools/WebFetchTool"
export { WebSearchTool } from "./tools/WebSearchTool"
export { QuestionTool } from "./tools/QuestionTool"
export { ApplyPatchTool } from "./tools/ApplyPatchTool"
export { ApplyUnifiedDiffTool } from "./tools/ApplyUnifiedDiffTool"
export { TodoWriteTool } from "./tools/TodoWriteTool"
export { HttpBodyTool } from "./tools/HttpBodyTool"
export { LspTool } from "./tools/LspTool"
export { AgentTool } from "./tools/AgentTool"
export { TaskTool } from "./tools/TaskTool"
export { SkillTool } from "./tools/SkillTool"

// ─── Service tags (re-exported for convenience) ───────────────────────────────

export { QuestionService } from "./tools/QuestionTool"
export { TodoService } from "./tools/TodoWriteTool"
export { LspService } from "./tools/LspTool"
export { AgentRunnerService } from "./tools/AgentTool"
export { TaskRunnerService } from "./tools/TaskTool"
export { SkillService } from "./tools/SkillTool"
export { ConfigService as WebSearchConfigService, defaultConfigLayer as webSearchDefaultConfigLayer } from "./tools/WebSearchTool"

// ─── Combined layer ──────────────────────────────────────────────────────────

import { Layer } from "effect"
import { layer as _toolRegistryLayer } from "./ToolRegistry"
import { layer as _toolPermissionEnforcerLayer } from "./ToolPermissionEnforcer"

/**
 * ToolControllerLayer — merges ToolRegistry + ToolPermissionEnforcer.
 *
 * Callers must provide:
 *   - PermissionRepository (from @gco/model-domain)
 */
export const ToolControllerLayer = Layer.mergeAll(_toolRegistryLayer, _toolPermissionEnforcerLayer)
