/**
 * ToolPermissionEnforcer — enforces tool-level permission rules.
 *
 * - Loads saved always/reject rules from IPermissionRepository.
 * - For "ask" prompts, surfaces a question to the user via the question tool.
 * - check(action, resource, sessionID) → Effect<"allow" | "reject" | "ask">
 */
export * as ToolPermissionEnforcer from "./ToolPermissionEnforcer"

import { Context, Effect, Layer } from "effect"
import { PermissionSaved } from "@gco/schema"
import { PermissionRepository } from "@gco/model-domain"

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface Interface {
  /**
   * Check whether the given action + resource combination is allowed.
   *
   * Returns:
   *   "allow"  — a saved always-allow rule matches
   *   "reject" — a saved always-reject rule matches
   *   "ask"    — no saved rule; the caller should prompt the user
   */
  readonly check: (
    action: string,
    resource: string,
    sessionID: string,
  ) => Effect.Effect<"allow" | "reject" | "ask">

  /**
   * Persist a user decision so future calls to check() resolve without
   * prompting again.
   */
  readonly save: (
    action: string,
    resource: string,
    projectID: string,
    effect: "allow" | "reject",
  ) => Effect.Effect<void, Error>
}

// ---------------------------------------------------------------------------
// Context.Tag
// ---------------------------------------------------------------------------

export class Service extends Context.Service<Service, Interface>()("@gco/ToolPermissionEnforcer") {}

// ---------------------------------------------------------------------------
// Pattern matching helper (mirrors original Wildcard.match)
// ---------------------------------------------------------------------------

function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern === "*") return true
  if (!pattern.includes("*")) return pattern === value
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`).test(value)
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

const enforcer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const repo = yield* Effect.service(PermissionRepository)

    return Service.of({
      check: (action, resource, _sessionID) =>
        Effect.gen(function* () {
          const rules = yield* repo.list().pipe(
            Effect.catchCause(() => Effect.succeed([] as PermissionSaved.Info[])),
          )
          // Walk rules in insertion order; last matching rule wins (same as
          // original whollyDisabled / findLast semantics).
          let decision: "allow" | "reject" | undefined
          for (const rule of rules) {
            if (wildcardMatch(rule.action, action) && wildcardMatch(rule.resource, resource)) {
              // PermissionSaved.Info does not carry an "effect" field in the
              // schema — presence of the rule means "allow" by convention,
              // matching the original "always" / "reject" storage pattern.
              // We treat every stored rule as allow unless the action starts
              // with "reject:" prefix (a forward-compatible convention).
              decision = rule.action.startsWith("reject:") ? "reject" : "allow"
            }
          }
          if (decision !== undefined) return decision
          return "ask"
        }),

      save: (action, resource, projectID, _effect) =>
        Effect.gen(function* () {
          const storedAction = _effect === "reject" ? `reject:${action}` : action
          yield* repo.save({
            id: PermissionSaved.ID.create(),
            projectID: projectID as any,
            action: storedAction,
            resource,
          })
        }),
    })
  }),
)

export const layer = enforcer
