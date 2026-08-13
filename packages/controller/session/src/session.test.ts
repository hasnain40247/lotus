import { describe, test, expect } from "bun:test"
import { Effect, Exit, Layer, Stream } from "effect"
import { TestModelLayer, seedSession, makeEvent } from "@gco/model-test"
import { EventRepository, SessionRepository } from "@gco/model-domain"
import { LLMClient, LLMEvent, Model } from "@gco/llm"
import { agentLayer } from "@gco/controller-agent"
import { toolRegistryLayer, toolPermissionEnforcerLayer } from "@gco/controller-tool"
import { McpController } from "@gco/controller-mcp"
import { SessionController, NotFoundError, sessionControllerLayer, SessionRunner, sessionRunnerLayer } from "./index"
import { ModelResolver } from "./ModelResolver"
import type { Session } from "@gco/schema"

// ─── Minimal fake Model that passes instanceof check ─────────────────────────
// The runner builds an LLMRequest that validates model via Schema.declare
// (value instanceof Model). We also need route.defaults for resolveRequestOptions.

const fakeRoute: any = {
  id: "test-route",
  defaults: {},
  body: { from: () => Effect.succeed({}) },
  prepareTransport: () => Effect.succeed({}),
  streamPrepared: () => Stream.empty,
}

const fakeModel = Object.assign(Object.create(Model.prototype), {
  id: "test-model",
  provider: "test-provider",
  route: fakeRoute,
})

// ─── Shared test model resolver ──────────────────────────────────────────────

const testModelResolverLayer = Layer.succeed(
  ModelResolver,
  ModelResolver.of({
    resolve: (_session: Session.Info) => Effect.succeed(fakeModel as unknown as Model),
  }),
)

// ─── Mock LLM layer ──────────────────────────────────────────────────────────

const mockLLMLayer = Layer.succeed(LLMClient.Service, {
  stream: (_request: any) =>
    Stream.fromIterable([
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.textStart({ id: "b1" }),
      LLMEvent.textDelta({ id: "b1", text: "Hello from mock LLM!" }),
      LLMEvent.textEnd({ id: "b1" }),
      LLMEvent.stepFinish({ index: 0, reason: "stop", usage: { inputTokens: 10, outputTokens: 5 } }),
      LLMEvent.finish({ reason: "stop", usage: { inputTokens: 10, outputTokens: 5 } }),
    ]),
  generate: (_request: any) => Effect.die("not used"),
  prepare: (_request: any) => Effect.die("not used"),
})

// ─── Group A: SessionController (no LLM call) ────────────────────────────────

// Stub McpController — session tests don't exercise real MCP flow; they
// just need the service present so SessionRunner can yield it.
const stubMcpLayer = Layer.succeed(
  McpController.Service,
  McpController.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    config: () => Effect.succeed({}),
    serverDefs: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void as any,
    disconnect: () => Effect.void as any,
    remove: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.succeed({ authorizationUrl: "", oauthState: "" }) as any,
    authenticate: () => Effect.succeed({ status: "disabled" as const }) as any,
    finishAuth: () => Effect.succeed({ status: "disabled" as const }) as any,
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false) as any,
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
    loadConfig: () => Effect.void,
  }),
)

const controllerInfraLayer = Layer.mergeAll(
  TestModelLayer,
  agentLayer,
  toolRegistryLayer,
  testModelResolverLayer,
  mockLLMLayer,
  stubMcpLayer,
  toolPermissionEnforcerLayer.pipe(Layer.provide(TestModelLayer)),
)

const runnerWithDeps = sessionRunnerLayer.pipe(Layer.provide(controllerInfraLayer))

const fullControllerLayer = sessionControllerLayer.pipe(
  Layer.provide(Layer.merge(controllerInfraLayer, runnerWithDeps)),
)

describe("SessionController", () => {
  test("create({}) creates and returns a session with an ID", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const ctrl = yield* SessionController
        const session = yield* ctrl.create({
          projectID: "proj_test",
          location: { directory: "/tmp/test" },
        })
        expect(session.id).toBeDefined()
      }).pipe(Effect.provide(fullControllerLayer)),
    )
  })

  test("create is idempotent when called with the same ID twice", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const ctrl = yield* SessionController
        const first = yield* ctrl.create({
          projectID: "proj_test",
          location: { directory: "/tmp/test" },
        })
        const second = yield* ctrl.create({
          id: first.id,
          projectID: "proj_test",
          location: { directory: "/tmp/test" },
        })
        expect(second.id).toBe(first.id)
      }).pipe(Effect.provide(fullControllerLayer)),
    )
  })

  test("get(id) returns the created session", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const ctrl = yield* SessionController
        const created = yield* ctrl.create({
          projectID: "proj_test",
          location: { directory: "/tmp/test" },
        })
        const found = yield* ctrl.get(created.id)
        expect(found.id).toBe(created.id)
      }).pipe(Effect.provide(fullControllerLayer)),
    )
  })

  test("get('missing') fails with NotFoundError", async () => {
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const ctrl = yield* SessionController
        return yield* ctrl.get("ses_missing_xyz" as any).pipe(Effect.exit)
      }).pipe(Effect.provide(fullControllerLayer)),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("list('proj_test') returns sessions for that project", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const ctrl = yield* SessionController
        yield* ctrl.create({ projectID: "proj_test", location: { directory: "/tmp/test" } })
        yield* ctrl.create({ projectID: "proj_test", location: { directory: "/tmp/test" } })
        const sessions = yield* ctrl.list("proj_test")
        expect(sessions.length).toBeGreaterThanOrEqual(2)
      }).pipe(Effect.provide(fullControllerLayer)),
    )
  })
})

// ─── Group B: SessionRunner round-trip ───────────────────────────────────────

const runnerInfraLayer = Layer.mergeAll(
  TestModelLayer,
  mockLLMLayer,
  toolRegistryLayer,
  agentLayer,
  testModelResolverLayer,
  stubMcpLayer,
  toolPermissionEnforcerLayer.pipe(Layer.provide(TestModelLayer)),
)

const runnerLayer = sessionRunnerLayer.pipe(Layer.provide(runnerInfraLayer))

describe("SessionRunner", () => {
  test("run with a prompt.admitted event writes step.ended to the event log", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const eventRepo = yield* EventRepository
        const sessionRepo = yield* SessionRepository
        const runner = yield* SessionRunner

        const session = seedSession({})
        yield* sessionRepo.create(session)
        yield* eventRepo.append(session.id, [
          makeEvent("session.next.prompt.admitted", {
            sessionID: session.id,
            text: "What is 2 + 2?",
            files: [],
            parts: [],
          }),
        ])

        // Runner loops back on the seeded prompt.admitted event, so we interrupt after first turn
        yield* runner.run({ sessionID: session.id, force: false }).pipe(
          Effect.timeout("2 seconds"),
          Effect.ignore,
        )

        const events = yield* eventRepo.load(session.id)
        const types = events.map((e) => e.type)
        expect(types).toContain("session.next.step.ended")
      }).pipe(Effect.provide(Layer.merge(runnerInfraLayer, runnerLayer))),
    )
  })

  test("run with force: true and empty event log completes without error", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessionRepo = yield* SessionRepository
        const runner = yield* SessionRunner

        const session = seedSession({})
        yield* sessionRepo.create(session)

        yield* runner.run({ sessionID: session.id, force: true })
      }).pipe(Effect.provide(Layer.merge(runnerInfraLayer, runnerLayer))),
    )
  })

  test("after a successful run, event repo contains step.started and step.ended", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const eventRepo = yield* EventRepository
        const sessionRepo = yield* SessionRepository
        const runner = yield* SessionRunner

        const session = seedSession({})
        yield* sessionRepo.create(session)
        yield* eventRepo.append(session.id, [
          makeEvent("session.next.prompt.admitted", {
            sessionID: session.id,
            text: "Hello!",
            files: [],
            parts: [],
          }),
        ])

        // Runner loops back on the seeded prompt.admitted event, so we interrupt after first turn
        yield* runner.run({ sessionID: session.id, force: false }).pipe(
          Effect.timeout("2 seconds"),
          Effect.ignore,
        )

        const events = yield* eventRepo.load(session.id)
        const types = events.map((e) => e.type)
        expect(types).toContain("session.next.step.started")
        expect(types).toContain("session.next.step.ended")
      }).pipe(Effect.provide(Layer.merge(runnerInfraLayer, runnerLayer))),
    )
  })
})
