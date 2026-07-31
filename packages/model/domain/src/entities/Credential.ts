/**
 * Credential entity — re-exported from @gco/schema with no duplication.
 *
 * Re-exports the Credential namespace (ID, OAuth, Key, Value types).
 * The `CredentialInfo` record type used by the repository interface lives in
 * `../repositories/ICredentialRepository.ts` to avoid a circular dependency.
 */
export { Credential } from "@gco/schema"
