import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { EventRepository, SessionRepository } from "@gco/model-domain"
import {
  InMemoryEventRepositoryLayer,
  InMemorySessionRepositoryLayer,
  seedSession,
  makeEvent,
} from "@gco/model-test"

const makeRepos = () =>
  Layer.mergeAll(InMemoryEventRepositoryLayer, InMemorySessionRepositoryLayer)

// ─── EventRepository ────────────────────────────────────────────────────────

describe("InMemoryEventRepository", () => {
  test("append stores events", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EventRepository
        const id = "ses_001" as any
        yield* repo.append(id, [makeEvent("session.next.prompt.admitted")])
        const events = yield* repo.load(id)
        expect(events.length).toBe(1)
      }).pipe(Effect.provide(makeRepos())),
    )
  })

  test("append auto-assigns sequential seq numbers", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EventRepository
        const id = "ses_002" as any
        yield* repo.append(id, [makeEvent("session.next.step.started")])
        yield* repo.append(id, [makeEvent("session.next.step.ended")])
        const events = yield* repo.load(id)
        expect(events[0].durable?.seq).toBe(1)
        expect(events[1].durable?.seq).toBe(2)
      }).pipe(Effect.provide(makeRepos())),
    )
  })

  test("load returns all events when no fromSeq given", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EventRepository
        const id = "ses_003" as any
        yield* repo.append(id, [makeEvent("session.next.prompt.admitted"), makeEvent("session.next.step.started")])
        const events = yield* repo.load(id)
        expect(events.length).toBe(2)
      }).pipe(Effect.provide(makeRepos())),
    )
  })

  test("load with fromSeq filters to events after that seq", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EventRepository
        const id = "ses_004" as any
        yield* repo.append(id, [
          makeEvent("session.next.prompt.admitted"),
          makeEvent("session.next.step.started"),
          makeEvent("session.next.step.ended"),
        ])
        const events = yield* repo.load(id, 1)
        expect(events.length).toBe(2)
        expect(events.every((e) => (e.durable?.seq ?? 0) > 1)).toBe(true)
      }).pipe(Effect.provide(makeRepos())),
    )
  })

  test("loadFromCompaction returns all events when no compaction boundary", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EventRepository
        const id = "ses_005" as any
        yield* repo.append(id, [makeEvent("session.next.prompt.admitted"), makeEvent("session.next.step.started")])
        const events = yield* repo.loadFromCompaction(id)
        expect(events.length).toBe(2)
      }).pipe(Effect.provide(makeRepos())),
    )
  })

  test("loadFromCompaction returns events from compaction boundary forward", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EventRepository
        const id = "ses_006" as any
        yield* repo.append(id, [
          makeEvent("session.next.prompt.admitted"),
          makeEvent("session.next.step.started"),
          makeEvent("session.next.compaction.ended"),
          makeEvent("session.next.step.ended"),
        ])
        const events = yield* repo.loadFromCompaction(id)
        const types = events.map((e) => e.type)
        expect(types).toContain("session.next.compaction.ended")
        expect(types).toContain("session.next.step.ended")
        expect(types).not.toContain("session.next.prompt.admitted")
      }).pipe(Effect.provide(makeRepos())),
    )
  })

  test("loadFromCompaction returns only events from the LAST compaction", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EventRepository
        const id = "ses_007" as any
        yield* repo.append(id, [
          makeEvent("session.next.prompt.admitted"),
          makeEvent("session.next.compaction.ended"),
          makeEvent("session.next.step.started"),
          makeEvent("session.next.compaction.ended"),
          makeEvent("session.next.step.ended"),
        ])
        const events = yield* repo.loadFromCompaction(id)
        expect(events[0].type).toBe("session.next.compaction.ended")
        expect(events[0].durable?.seq).toBe(4)
        expect(events.length).toBe(2)
      }).pipe(Effect.provide(makeRepos())),
    )
  })
})

// ─── SessionRepository ───────────────────────────────────────────────────────

describe("InMemorySessionRepository", () => {
  test("create and get by id", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* SessionRepository
        const session = seedSession({})
        yield* repo.create(session)
        const found = yield* repo.get(session.id)
        expect(found?.id).toBe(session.id)
      }).pipe(Effect.provide(makeRepos())),
    )
  })

  test("get returns undefined for missing id", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* SessionRepository
        const found = yield* repo.get("ses_missing" as any)
        expect(found).toBeUndefined()
      }).pipe(Effect.provide(makeRepos())),
    )
  })

  test("list by projectID returns only matching sessions", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* SessionRepository
        const s1 = seedSession({ projectID: "proj_a" as any })
        const s2 = seedSession({ projectID: "proj_b" as any })
        yield* repo.create(s1)
        yield* repo.create(s2)
        const results = yield* repo.list("proj_a")
        expect(results.length).toBe(1)
        expect(results[0].id).toBe(s1.id)
      }).pipe(Effect.provide(makeRepos())),
    )
  })

  test("list with cursor paginates correctly", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* SessionRepository
        const s1 = seedSession({ projectID: "proj_test" as any })
        const s2 = seedSession({ projectID: "proj_test" as any })
        const s3 = seedSession({ projectID: "proj_test" as any })
        yield* repo.create(s1)
        yield* repo.create(s2)
        yield* repo.create(s3)
        const page = yield* repo.list("proj_test", { cursor: s1.id })
        expect(page.every((s) => s.id !== s1.id)).toBe(true)
      }).pipe(Effect.provide(makeRepos())),
    )
  })

  test("update patches fields", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* SessionRepository
        const session = seedSession({})
        yield* repo.create(session)
        yield* repo.update(session.id, { title: "Updated Title" })
        const updated = yield* repo.get(session.id)
        expect(updated?.title).toBe("Updated Title")
      }).pipe(Effect.provide(makeRepos())),
    )
  })

  test("archive sets time.archived", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* SessionRepository
        const session = seedSession({})
        yield* repo.create(session)
        yield* repo.archive(session.id)
        const archived = yield* repo.get(session.id)
        expect(archived?.time.archived).toBeDefined()
      }).pipe(Effect.provide(makeRepos())),
    )
  })
})
