import { DateTime } from "effect"
import type { Session, SessionEvent } from "@gco/model-domain"
import { descending, ascending } from "@gco/schema/identifier"

const DEFAULT_PROJECT_ID = "proj_test" as Session.Info["projectID"]
const DEFAULT_WORKTREE = "/tmp/test" as Session.Info["location"]["directory"]

/**
 * Seed a session into the in-memory store for tests.
 * Fills in all required fields with sensible defaults so callers only
 * need to supply the fields they care about.
 */
export function seedSession(session: Partial<Session.Info>): Session.Info {
  const now = DateTime.nowUnsafe()
  const id = session.id ?? (("ses_" + descending()) as Session.ID)

  return {
    id,
    projectID: DEFAULT_PROJECT_ID,
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    time: {
      created: now,
      updated: now,
    },
    title: "Test Session",
    location: {
      directory: DEFAULT_WORKTREE,
    },
    ...session,
  } as Session.Info
}

/**
 * Create a minimal valid DurableEvent for tests.
 * Returns a synthetic event shaped object suitable for passing to
 * InMemoryEventRepository.append. The `type` field must match a known
 * SessionEvent type for real event-sourcing scenarios; any string is
 * accepted here for flexibility in unit tests.
 */
export function makeEvent(type: string, data?: object): SessionEvent.DurableEvent {
  const id = ("evt_" + ascending()) as SessionEvent.DurableEvent["id"]
  const sessionID = ("ses_" + descending()) as string
  const timestamp = DateTime.nowUnsafe()

  return {
    id,
    type,
    data: {
      sessionID,
      timestamp,
      ...data,
    },
  } as unknown as SessionEvent.DurableEvent
}
