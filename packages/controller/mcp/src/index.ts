/**
 * @gco/controller-mcp — public surface.
 *
 * Exports McpController (Effect service), McpAuthController, McpCatalogController,
 * and the OAuth helpers.
 */

// Main services
export { McpController } from "./McpController"
export { McpAuthController } from "./McpAuthController"
export { McpCatalogController } from "./McpCatalogController"

// OAuth helpers
export { McpOAuthCallback } from "./oauth-callback"
export {
  McpOAuthProvider,
  McpOAuthPendingProvider,
  OAUTH_CALLBACK_PORT,
  OAUTH_CALLBACK_PATH,
  parseRedirectUri,
  type McpOAuthConfig,
  type McpOAuthCallbacks,
} from "./oauth-provider"

// Config schema
export { McpConfig } from "./mcp-config"

// Convenience type re-exports
export type {
  Interface as McpInterface,
  Status as McpStatus,
  AuthStatus as McpAuthStatus,
  McpTool,
  ServerInstructions as McpServerInstructions,
  McpControllerCallbacks,
} from "./McpController"

export {
  Service as McpService,
  NotFoundError as McpNotFoundError,
  layer as mcpLayer,
  makeLayer as makeMcpLayer,
} from "./McpController"

export { Service as McpAuthService, layer as mcpAuthLayer } from "./McpAuthController"
