/**
 * @gco/model-secrets
 *
 * Provides SecretsModelLayer — an Effect Layer that binds CredentialRepository
 * to the SecretManagerCredentialRepository implementation.
 *
 * Usage:
 *   program.pipe(
 *     Effect.provide(SecretsModelLayer),
 *     Effect.provide(SecretManagerClient.layer),
 *     Effect.provide(GcpConfig.layer),
 *   )
 */

export { makeSecretManagerCredentialRepository } from "./SecretManagerCredentialRepository"

import { Layer } from "effect"
import { CredentialRepository } from "@gco/model-domain"
import { makeSecretManagerCredentialRepository } from "./SecretManagerCredentialRepository"

/**
 * Effect Layer that provides CredentialRepository backed by
 * Secret Manager (values) and Firestore (reference docs).
 *
 * Requires in context: SecretManagerClient, GcpConfig
 */
export const SecretsModelLayer = Layer.effect(
  CredentialRepository,
  makeSecretManagerCredentialRepository(),
)
