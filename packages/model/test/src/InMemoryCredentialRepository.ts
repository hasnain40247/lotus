import { Effect, Layer } from "effect"
import { CredentialRepository } from "@gco/model-domain"
import type { CredentialInfo } from "@gco/model-domain"
import type { Credential, Integration } from "@gco/model-domain"
import { ascending } from "@gco/schema/identifier"

export const InMemoryCredentialRepositoryLive = Layer.succeed(CredentialRepository, (() => {
  const store = new Map<string, CredentialInfo>()

  return {
    all(): Effect.Effect<CredentialInfo[], Error> {
      return Effect.sync(() => [...store.values()])
    },

    list(integrationID: Integration.ID): Effect.Effect<CredentialInfo[], Error> {
      return Effect.sync(() =>
        [...store.values()].filter((c) => c.integrationID === integrationID)
      )
    },

    get(id: Credential.ID): Effect.Effect<CredentialInfo | undefined, Error> {
      return Effect.sync(() => store.get(id))
    },

    create(input: {
      readonly integrationID: Integration.ID
      readonly value: Credential.Value
      readonly label?: string
    }): Effect.Effect<CredentialInfo, Error> {
      return Effect.sync(() => {
        const id = ("cred_" + ascending()) as Credential.ID
        const info: CredentialInfo = {
          id,
          integrationID: input.integrationID,
          label: input.label ?? "",
          value: input.value,
        }
        store.set(id, info)
        return info
      })
    },

    update(
      id: Credential.ID,
      updates: Partial<Pick<CredentialInfo, "label" | "value">>,
    ): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        const existing = store.get(id)
        if (existing) {
          store.set(id, { ...existing, ...updates })
        }
      })
    },

    remove(id: Credential.ID): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        store.delete(id)
      })
    },
  }
})())

export const layer = InMemoryCredentialRepositoryLive
