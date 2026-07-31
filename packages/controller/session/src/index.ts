/**
 * @gco/controller-session
 *
 * Session controller package — Effect services for creating, managing,
 * running, exporting, and importing sessions.
 *
 * Provides:
 *   SessionController — CRUD + prompt/interrupt/resume/revert
 *   SessionRunner     — LLM turn orchestrator
 *   ModelResolver     — interface + tag for resolving LLM models from sessions
 *   SessionExporter   — JSON/Markdown export → GCS
 *   SessionImporter   — GCS / local import → IEventRepository
 */

// ─── SessionController ───────────────────────────────────────────────────────

export {
  SessionController,
  NotFoundError,
  PromptConflictError,
  MessageNotFoundError,
  layer as sessionControllerLayer,
} from "./SessionController"
export type {
  CreateInput as SessionCreateInput,
  PromptInput as SessionPromptInput,
  Interface as SessionControllerInterface,
} from "./SessionController"

// ─── ModelResolver ───────────────────────────────────────────────────────────

export {
  ModelResolver,
  ModelNotResolvedError,
} from "./ModelResolver"
export type { Interface as ModelResolverInterface } from "./ModelResolver"

// ─── SessionRunner ───────────────────────────────────────────────────────────

export {
  SessionRunner,
  layer as sessionRunnerLayer,
} from "./SessionRunner"
export type {
  RunInput as SessionRunInput,
  RunError as SessionRunError,
  Interface as SessionRunnerInterface,
} from "./SessionRunner"

// ─── SessionExporter ─────────────────────────────────────────────────────────

export {
  SessionExporter,
  layer as sessionExporterLayer,
} from "./SessionExporter"
export type {
  ExportInput as SessionExportInput,
  ExportOutput as SessionExportOutput,
  ExportFormat,
  Interface as SessionExporterInterface,
} from "./SessionExporter"

// ─── SessionImporter ─────────────────────────────────────────────────────────

export {
  SessionImporter,
  layer as sessionImporterLayer,
} from "./SessionImporter"
export type {
  ImportInput as SessionImportInput,
  ImportOutput as SessionImportOutput,
  Interface as SessionImporterInterface,
} from "./SessionImporter"
