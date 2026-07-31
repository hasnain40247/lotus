import { Context, Effect } from "effect"
import type { PermissionSaved } from "@gco/schema"

/**
 * Repository for persisted always/reject permission decisions.
 *
 * When a user chooses "always allow" or "always reject" for a tool action,
 * that decision is stored here and consulted before prompting the user again.
 */
export interface IPermissionRepository {
  /** Return every saved permission rule. */
  list(): Effect.Effect<PermissionSaved.Info[], Error>

  /** Return saved rules for a specific project. */
  listForProject(projectID: string): Effect.Effect<PermissionSaved.Info[], Error>

  /**
   * Persist a new always/reject decision.
   * If a rule for the same project + action + resource already exists,
   * implementations should replace it.
   */
  save(info: PermissionSaved.Info): Effect.Effect<void, Error>

  /** Remove a specific saved permission rule. */
  remove(id: PermissionSaved.ID): Effect.Effect<void, Error>

  /** Remove all saved permission rules for a project. */
  removeAllForProject(projectID: string): Effect.Effect<void, Error>
}

export class PermissionRepository extends Context.Service<PermissionRepository, IPermissionRepository>()("PermissionRepository") {}
