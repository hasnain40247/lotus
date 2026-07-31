/**
 * ModelResolver — resolves a `@gco/llm` Model from a Session.Info.
 *
 * The actual implementation must be provided by the application layer
 * (e.g. CLI or server) because it depends on which provider is configured.
 * The controller-session package only defines the interface and the tag.
 *
 * Example implementations:
 *   - Vertex AI: resolves through @gco/cloud/vertex
 *   - Anthropic direct: resolves through @gco/llm protocols/anthropic-messages
 */

import { Context, Effect } from "effect"
import type { Model } from "@gco/llm"
import type { Session } from "@gco/schema"

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ModelNotResolvedError extends Error {
  override readonly name = "ModelNotResolvedError"
  readonly sessionID: Session.ID

  constructor(input: { sessionID: Session.ID; reason?: string }) {
    super(input.reason ?? `No model configured for session ${input.sessionID}`)
    this.sessionID = input.sessionID
  }
}

// ---------------------------------------------------------------------------
// Interface & Tag
// ---------------------------------------------------------------------------

export interface Interface {
  readonly resolve: (session: Session.Info) => Effect.Effect<Model, ModelNotResolvedError>
}

export class ModelResolver extends Context.Service<ModelResolver, Interface>()(
  "@gco/ModelResolver",
) {}
