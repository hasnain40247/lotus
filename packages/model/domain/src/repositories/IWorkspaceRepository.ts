import { Context, Effect } from "effect"
import type { Workspace } from "@gco/schema"

/**
 * Workspace metadata record.
 *
 * A workspace represents a named environment (e.g. a git worktree or remote
 * dev container) that groups one or more sessions. The "home" workspace is
 * special and corresponds to the primary local working tree.
 */
export interface WorkspaceInfo {
  readonly id: Workspace.ID
  /** Human-readable name for this workspace (e.g. "main", "feature/x"). */
  readonly name: string
  /** Absolute path to the workspace root directory. */
  readonly directory: string
  readonly time: {
    readonly created: number
    readonly updated: number
  }
}

/**
 * Repository for workspace metadata.
 *
 * Workspaces are created automatically when a new worktree or remote environment
 * is registered. The controller layer manages workspace lifecycle; this repo
 * only handles persistence.
 */
export interface IWorkspaceRepository {
  /** Return a workspace by ID, or undefined if it does not exist. */
  get(id: Workspace.ID): Effect.Effect<WorkspaceInfo | undefined, Error>

  /** Return all stored workspaces. */
  list(): Effect.Effect<WorkspaceInfo[], Error>

  /**
   * Persist a new workspace record.
   * Implementations should treat duplicate IDs as a no-op (idempotent create).
   */
  create(info: WorkspaceInfo): Effect.Effect<void, Error>

  /** Apply a partial update to an existing workspace. */
  update(id: Workspace.ID, patch: Partial<WorkspaceInfo>): Effect.Effect<void, Error>

  /** Remove a workspace record. */
  remove(id: Workspace.ID): Effect.Effect<void, Error>
}

export class WorkspaceRepository extends Context.Service<WorkspaceRepository, IWorkspaceRepository>()("WorkspaceRepository") {}
