import { Effect, Layer } from "effect"
import { ProjectRepository } from "@gco/model-domain"
import type { Project } from "@gco/model-domain"

export const InMemoryProjectRepositoryLive = Layer.succeed(ProjectRepository, (() => {
  const store = new Map<string, Project.Info>()

  return {
    get(id: Project.ID): Effect.Effect<Project.Info | undefined, Error> {
      return Effect.sync(() => store.get(id))
    },

    getByWorktree(worktree: string): Effect.Effect<Project.Info | undefined, Error> {
      return Effect.sync(() =>
        [...store.values()].find((p) => p.worktree === worktree)
      )
    },

    list(): Effect.Effect<Project.Info[], Error> {
      return Effect.sync(() => [...store.values()])
    },

    create(info: Project.Info): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        // Idempotent: no-op if already exists
        if (!store.has(info.id)) {
          store.set(info.id, info)
        }
      })
    },

    update(id: Project.ID, patch: Partial<Project.Info>): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        const existing = store.get(id)
        if (existing) {
          store.set(id, { ...existing, ...patch })
        }
      })
    },
  }
})())

export const layer = InMemoryProjectRepositoryLive
