import { Effect, Layer } from "effect"
import { WorkspaceRepository } from "@gco/model-domain"
import type { WorkspaceInfo } from "@gco/model-domain"
import type { Workspace } from "@gco/model-domain"

export const InMemoryWorkspaceRepositoryLive = Layer.succeed(WorkspaceRepository, (() => {
  const store = new Map<string, WorkspaceInfo>()

  return {
    get(id: Workspace.ID): Effect.Effect<WorkspaceInfo | undefined, Error> {
      return Effect.sync(() => store.get(id))
    },

    list(): Effect.Effect<WorkspaceInfo[], Error> {
      return Effect.sync(() => [...store.values()])
    },

    create(info: WorkspaceInfo): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        // Idempotent: no-op if already exists
        if (!store.has(info.id)) {
          store.set(info.id, info)
        }
      })
    },

    update(id: Workspace.ID, patch: Partial<WorkspaceInfo>): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        const existing = store.get(id)
        if (existing) {
          store.set(id, { ...existing, ...patch })
        }
      })
    },

    remove(id: Workspace.ID): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        store.delete(id)
      })
    },
  }
})())

export const layer = InMemoryWorkspaceRepositoryLive
