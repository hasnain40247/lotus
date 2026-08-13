import { DateTime, Effect, Layer } from "effect"
import { SessionRepository } from "@gco/model-domain"
import type { Session } from "@gco/model-domain"
import type { ListAnchor } from "@gco/model-domain"

export const InMemorySessionRepositoryLive = Layer.succeed(SessionRepository, (() => {
  const store = new Map<string, Session.Info>()

  return {
    get(id: Session.ID): Effect.Effect<Session.Info | undefined, Error> {
      return Effect.sync(() => store.get(id))
    },

    list(projectID: string, anchor?: ListAnchor): Effect.Effect<Session.Info[], Error> {
      return Effect.sync(() => {
        let results = [...store.values()].filter((s) => s.projectID === projectID && s.time.archived === undefined)

        if (anchor?.cursor) {
          const cursorIndex = results.findIndex((s) => s.id === anchor.cursor)
          if (cursorIndex !== -1) {
            results = results.slice(cursorIndex + 1)
          }
        }

        if (anchor?.limit !== undefined) {
          results = results.slice(0, anchor.limit)
        }

        return results
      })
    },

    create(info: Session.Info): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        store.set(info.id, info)
      })
    },

    update(id: Session.ID, patch: Partial<Session.Info>): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        const existing = store.get(id)
        if (existing) {
          store.set(id, { ...existing, ...patch })
        }
      })
    },

    archive(id: Session.ID): Effect.Effect<void, Error> {
      return Effect.sync(() => {
        const existing = store.get(id)
        if (existing) {
          store.set(id, {
            ...existing,
            time: {
              ...existing.time,
              archived: DateTime.nowUnsafe(),
            },
          })
        }
      })
    },
  }
})())

export const layer = InMemorySessionRepositoryLive
