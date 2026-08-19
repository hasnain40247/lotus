import { Context, Effect } from "effect"
import type { Credential, Integration } from "@gco/schema"

export interface CredentialInfo {
  readonly id: Credential.ID
  readonly integrationID: Integration.ID
  readonly label: string
  readonly value: Credential.Value
}

/**
 * Repository for stored LLM provider credentials (API keys, OAuth tokens).
 *
 * Storage backend is opaque to callers; the local implementation persists
 * to SQLite (`credentials` table). The trust boundary is the same as
 * `neko.json` — plaintext at rest inside the user's home directory.
 */
export interface ICredentialRepository {
  /** Return every stored credential across all integrations. */
  all(): Effect.Effect<CredentialInfo[], Error>

  /** Return credentials scoped to a specific integration. */
  list(integrationID: Integration.ID): Effect.Effect<CredentialInfo[], Error>

  /** Get one credential by ID, or undefined if it does not exist. */
  get(id: Credential.ID): Effect.Effect<CredentialInfo | undefined, Error>

  /** Persist a new credential; returns the record with its assigned ID. */
  create(input: {
    readonly integrationID: Integration.ID
    readonly value: Credential.Value
    readonly label?: string
  }): Effect.Effect<CredentialInfo, Error>

  /** Apply a partial update; only `label` and `value` are mutable. */
  update(
    id: Credential.ID,
    updates: Partial<Pick<CredentialInfo, "label" | "value">>,
  ): Effect.Effect<void, Error>

  /** Delete a credential. */
  remove(id: Credential.ID): Effect.Effect<void, Error>
}

export class CredentialRepository extends Context.Service<CredentialRepository, ICredentialRepository>()(
  "CredentialRepository",
) {}
