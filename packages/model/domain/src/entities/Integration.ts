/**
 * Integration entity — re-exported from @gco/schema with no duplication.
 *
 * Integrations own a set of credentials (OAuth tokens, API keys) accessed via
 * ICredentialRepository. The Integration.ID type is the foreign key used by
 * CredentialInfo.integrationID.
 */
export { Integration } from "@gco/schema"
