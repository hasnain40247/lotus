/**
 * @gco/model-domain
 *
 * Two responsibilities:
 *  1. Re-export entity namespaces from @gco/schema — single stable import
 *     point for the model layer; no type duplication.
 *  2. Define TypeScript repository interfaces and Effect Context.Tag services
 *     that every data implementation (SQLite/JSON, in-memory test) must satisfy.
 */

// ─── Entity re-exports ────────────────────────────────────────────────────────

export { Agent } from "./entities/Agent"
export { Credential } from "./entities/Credential"
export { Integration } from "./entities/Integration"
export { Permission, PermissionSaved } from "./entities/Permission"
export { Project } from "./entities/Project"
export { Session } from "./entities/Session"
export { SessionEvent } from "./entities/SessionEvent"

// ─── Repository interfaces + Effect Context.Tag services ─────────────────────

export type { ICredentialRepository, CredentialInfo } from "./repositories/ICredentialRepository"
export { CredentialRepository } from "./repositories/ICredentialRepository"

export type { IEventRepository } from "./repositories/IEventRepository"
export { EventRepository } from "./repositories/IEventRepository"

export type { IPermissionRepository } from "./repositories/IPermissionRepository"
export { PermissionRepository } from "./repositories/IPermissionRepository"

export type { IProjectRepository } from "./repositories/IProjectRepository"
export { ProjectRepository } from "./repositories/IProjectRepository"

export type { ISessionRepository, ListAnchor } from "./repositories/ISessionRepository"
export { SessionRepository } from "./repositories/ISessionRepository"
