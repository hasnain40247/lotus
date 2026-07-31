import { Effect, Layer } from "effect"
import { PermissionRepository } from "@gco/model-domain"
import type { PermissionSaved } from "@gco/model-domain"

export const InMemoryPermissionRepositoryLive = Layer.succeed(PermissionRepository, (() => {
  const store = new Map<string, PermissionSaved.Info>()

  return {
    list(): Effect.Effect<PermissionSaved.Info[], Error> {
      return Effect.sync(() => [...store.values()])
    },

    listForProject(projectID: string): Effect.Effect<PermissionSaved.Info[], Error> {
      return Effect.sync(() =>
        [...store.values()].filter((p) => p.projectID === projectID)
      )
    },

    save(info: PermissionSaved.Info): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        // Replace any existing rule for the same project + action + resource
        for (const [key, existing] of store.entries()) {
          if (
            existing.projectID === info.projectID &&
            existing.action === info.action &&
            existing.resource === info.resource
          ) {
            store.delete(key)
            break
          }
        }
        store.set(info.id, info)
      })
    },

    remove(id: PermissionSaved.ID): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        store.delete(id)
      })
    },

    removeAllForProject(projectID: string): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        for (const [key, info] of store.entries()) {
          if (info.projectID === projectID) {
            store.delete(key)
          }
        }
      })
    },
  }
})())

export const layer = InMemoryPermissionRepositoryLive
