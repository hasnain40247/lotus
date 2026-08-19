import { Effect, Layer } from "effect"
import {
  CredentialRepository,
  type CredentialInfo,
  Credential,
  type Integration,
} from "@gco/model-domain"

export const InMemoryCredentialRepositoryLive = Layer.succeed(CredentialRepository, (() => {
  const store = new Map<string, CredentialInfo>()

  return {
    all(): Effect.Effect<CredentialInfo[], Error> {
      return Effect.sync(() => [...store.values()])
    },

    list(integrationID: Integration.ID): Effect.Effect<CredentialInfo[], Error> {
      return Effect.sync(() =>
        [...store.values()].filter((c) => c.integrationID === integrationID),
      )
    },

    get(id: Credential.ID): Effect.Effect<CredentialInfo | undefined, Error> {
      return Effect.sync(() => store.get(id as string))
    },

    create(input: {
      readonly integrationID: Integration.ID
      readonly value: Credential.Value
      readonly label?: string
    }): Effect.Effect<CredentialInfo, Error> {
      return Effect.sync(() => {
        const id = Credential.ID.create()
        const info: CredentialInfo = {
          id,
          integrationID: input.integrationID,
          label: input.label ?? "",
          value: input.value,
        }
        store.set(id as string, info)
        return info
      })
    },

    update(
      id: Credential.ID,
      updates: Partial<Pick<CredentialInfo, "label" | "value">>,
    ): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        const existing = store.get(id as string)
        if (existing) store.set(id as string, { ...existing, ...updates })
      })
    },

    remove(id: Credential.ID): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        store.delete(id as string)
      })
    },
  }
})())

export const layer = InMemoryCredentialRepositoryLive
