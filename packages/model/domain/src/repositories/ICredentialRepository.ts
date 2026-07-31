import { Context, Effect } from "effect"
import type { Credential, Integration } from "@gco/schema"

/**
 * Stored credential record.
 *
 * This type mirrors `Credential.Info` from the original `core/src/credential.ts`
 * and must remain structurally identical so that all callers that depend on
 * the original `Credential.Interface` continue to work without modification.
 */
export interface CredentialInfo {
  readonly id: Credential.ID
  readonly integrationID: Integration.ID
  readonly label: string
  readonly value: Credential.Value
}

/**
 * Repository interface for stored credentials.
 *
 * CRITICAL: The method names and signatures are an exact match of the original
 * `Credential.Interface` in `packages/core/src/credential.ts`. Any implementation
 * (e.g. `SecretManagerCredentialRepository`) must satisfy this contract so that
 * controllers and callers require zero changes.
 */
export interface ICredentialRepository {
  /** Returns every stored credential. */
  readonly all: () => Effect.Effect<CredentialInfo[], Error>
  /** Returns stored credentials belonging to one integration. */
  readonly list: (integrationID: Integration.ID) => Effect.Effect<CredentialInfo[], Error>
  /** Returns one stored credential by ID. */
  readonly get: (id: Credential.ID) => Effect.Effect<CredentialInfo | undefined, Error>
  /** Replaces any credential for an integration and returns the new record. */
  readonly create: (input: {
    readonly integrationID: Integration.ID
    readonly value: Credential.Value
    readonly label?: string
  }) => Effect.Effect<CredentialInfo, Error>
  /** Updates the label or secret value of a stored credential. */
  readonly update: (
    id: Credential.ID,
    updates: Partial<Pick<CredentialInfo, "label" | "value">>,
  ) => Effect.Effect<void, Error>
  /** Removes a stored credential. */
  readonly remove: (id: Credential.ID) => Effect.Effect<void, Error>
}

export class CredentialRepository extends Context.Service<CredentialRepository, ICredentialRepository>()("CredentialRepository") {}
