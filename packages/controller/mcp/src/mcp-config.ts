/**
 * MCP server configuration schema.
 *
 * Ported from packages/core/src/v1/config/mcp.ts — kept as a local
 * definition so @gco/controller-mcp has no dependency on @lotus-code/core.
 *
 * Written for effect ^3.14.0 (v3 API).
 */
export * as McpConfig from "./mcp-config"

import { Schema } from "effect"

// effect v4 filter combinators
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

const PortInt = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))

export const Local = Schema.Struct({
  type: Schema.Literal("local"),
  command: Schema.mutable(Schema.Array(Schema.String)),
  cwd: Schema.optional(Schema.String),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  enabled: Schema.optional(Schema.Boolean),
  timeout: Schema.optional(PositiveInt),
}).annotate({ identifier: "McpLocalConfig" })
export type Local = Schema.Schema.Type<typeof Local>

export const OAuth = Schema.Struct({
  clientId: Schema.optional(Schema.String),
  clientSecret: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
  callbackPort: Schema.optional(PortInt),
  redirectUri: Schema.optional(Schema.String),
}).annotate({ identifier: "McpOAuthConfig" })
export type OAuth = Schema.Schema.Type<typeof OAuth>

export const Remote = Schema.Struct({
  type: Schema.Literal("remote"),
  url: Schema.String,
  enabled: Schema.optional(Schema.Boolean),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  oauth: Schema.optional(Schema.Union([OAuth, Schema.Literal(false)])),
  timeout: Schema.optional(PositiveInt),
}).annotate({ identifier: "McpRemoteConfig" })
export type Remote = Schema.Schema.Type<typeof Remote>

export const Info = Schema.Union([Local, Remote]).annotate({ discriminator: "type" })
export type Info = Schema.Schema.Type<typeof Info>
