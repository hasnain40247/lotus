import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { Service as AgentController, layer as agentLayer } from "./AgentController"

describe("AgentController", () => {
  test("built-in agents are seeded on startup — build exists", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const controller = yield* AgentController
        const agent = yield* controller.get("build" as any)
        expect(agent).toBeDefined()
      }).pipe(Effect.provide(agentLayer)),
    )
  })

  test("built-in agents are seeded on startup — explore exists", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const controller = yield* AgentController
        const agent = yield* controller.get("explore" as any)
        expect(agent).toBeDefined()
      }).pipe(Effect.provide(agentLayer)),
    )
  })

  test("built-in agents are seeded on startup — plan exists", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const controller = yield* AgentController
        const agent = yield* controller.get("plan" as any)
        expect(agent).toBeDefined()
      }).pipe(Effect.provide(agentLayer)),
    )
  })

  test("get('build') returns the build agent", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const controller = yield* AgentController
        const agent = yield* controller.get("build" as any)
        expect(agent?.id as string).toBe("build")
      }).pipe(Effect.provide(agentLayer)),
    )
  })

  test("get('nonexistent') returns undefined", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const controller = yield* AgentController
        const agent = yield* controller.get("nonexistent" as any)
        expect(agent).toBeUndefined()
      }).pipe(Effect.provide(agentLayer)),
    )
  })

  test("resolve() with no args returns the default agent", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const controller = yield* AgentController
        const agent = yield* controller.resolve()
        expect(agent).toBeDefined()
      }).pipe(Effect.provide(agentLayer)),
    )
  })

  test("resolve('explore') returns the explore agent", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const controller = yield* AgentController
        const agent = yield* controller.resolve("explore")
        expect(agent?.id as string).toBe("explore")
      }).pipe(Effect.provide(agentLayer)),
    )
  })

  test("resolve('nonexistent') returns undefined", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const controller = yield* AgentController
        const agent = yield* controller.resolve("nonexistent")
        expect(agent).toBeUndefined()
      }).pipe(Effect.provide(agentLayer)),
    )
  })

  test("all() returns at least the built-in non-hidden agents", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const controller = yield* AgentController
        const agents = yield* controller.all()
        const ids = agents.map((a) => a.id)
        expect(ids as string[]).toContain("build")
        expect(ids as string[]).toContain("plan")
      }).pipe(Effect.provide(agentLayer)),
    )
  })

  test("default agent has mode 'primary'", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const controller = yield* AgentController
        const agent = yield* controller.resolve()
        expect(agent?.mode).toBe("primary")
      }).pipe(Effect.provide(agentLayer)),
    )
  })
})
