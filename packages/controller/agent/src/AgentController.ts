/**
 * AgentController — Effect service for managing named agent configurations.
 *
 * Ported from packages/core/src/agent.ts.
 * Manages a mutable in-memory registry of Agent.Info objects, supports
 * get/list/default/select operations, and exposes a `transform` API
 * for batched mutations (used by AgentRegistry.merge during startup).
 */
export * as AgentController from "./AgentController"

import { Array, Context, Effect, Layer, Types } from "effect"
import { Agent } from "@gco/schema"
import { AgentRegistry } from "./AgentRegistry"

// ---------------------------------------------------------------------------
// Re-exports from schema for convenience
// ---------------------------------------------------------------------------

export const ID = Agent.ID
export type ID = typeof ID.Type

export const Info = Agent.Info
export type Info = Agent.Info

export const defaultID = ID.make("build")

// ---------------------------------------------------------------------------
// Selection type
// ---------------------------------------------------------------------------

export interface Selection {
  readonly id: ID
  readonly info: Info | undefined
}

// ---------------------------------------------------------------------------
// Draft (mutable view passed to transform callbacks)
// ---------------------------------------------------------------------------

export type Draft = {
  list: () => readonly Info[]
  get: (id: ID) => Info | undefined
  default: (id: ID | undefined) => void
  update: (id: ID, fn: (agent: Types.DeepMutable<Info>) => void) => void
  remove: (id: ID) => void
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

type State = {
  agents: Map<ID, Types.DeepMutable<Info>>
  default?: ID
}

function createState(): State {
  return { agents: new Map() }
}

function emptyInfo(id: ID): Types.DeepMutable<Info> {
  return {
    id,
    request: { headers: {}, body: {} },
    mode: "all",
    hidden: false,
    permissions: [],
  }
}

function makeDraft(state: State): Draft {
  return {
    list: () => Array.fromIterable(state.agents.values()) as Info[],
    get: (id) => state.agents.get(id),
    default: (id) => {
      state.default = id
    },
    update: (id, fn) => {
      const current = state.agents.get(id) ?? emptyInfo(id)
      if (!state.agents.has(id)) state.agents.set(id, current)
      fn(current)
      current.id = id
    },
    remove: (id) => {
      state.agents.delete(id)
    },
  }
}

function isSelectable(agent: Info | undefined): agent is Info {
  return agent !== undefined && agent.mode !== "subagent" && !agent.hidden
}

function selectedDefault(state: State): Info | undefined {
  const configured = state.default ? (isSelectable(state.agents.get(state.default)) ? state.agents.get(state.default) : undefined) : undefined
  if (configured) return configured
  const build = state.agents.get(defaultID)
  if (build && isSelectable(build)) return build
  for (const agent of state.agents.values()) {
    if (isSelectable(agent)) return agent
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface Interface {
  /** Get a single agent by ID. */
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /** Return the default agent (usually "build"). */
  readonly default: () => Effect.Effect<Info | undefined>
  /** Resolve an agent by ID string or return the default if undefined. */
  readonly resolve: (id?: ID | string) => Effect.Effect<Info | undefined>
  /** Select an agent, returning both its ID and info. */
  readonly select: (id?: ID | string) => Effect.Effect<Selection>
  /** List all agents (including hidden/subagent ones). */
  readonly all: () => Effect.Effect<Info[]>
  /**
   * Apply a batch mutation to the agent registry.
   * The callback receives a `Draft` with mutable helper methods.
   */
  readonly transform: (fn: (draft: Draft) => void) => Effect.Effect<void>
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class Service extends Context.Service<Service, Interface>()("@gco/AgentController") {}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = createState()

    // Seed with built-in agents
    const builtIns = AgentRegistry.builtInAgents()
    for (const [id, info] of builtIns) {
      state.agents.set(id, info as Types.DeepMutable<Info>)
    }

    const get = Effect.fn("AgentController.get")(function* (id: ID) {
      return state.agents.get(id) as Info | undefined
    })

    const defaultAgent = Effect.fn("AgentController.default")(function* () {
      return selectedDefault(state)
    })

    const resolve = Effect.fn("AgentController.resolve")(function* (id?: ID | string) {
      if (id !== undefined) return state.agents.get(ID.make(id)) as Info | undefined
      return selectedDefault(state)
    })

    const select = Effect.fn("AgentController.select")(function* (id?: ID | string) {
      if (id !== undefined) {
        const selected = ID.make(id)
        return { id: selected, info: state.agents.get(selected) as Info | undefined } satisfies Selection
      }
      const info = selectedDefault(state)
      return { id: info?.id ?? defaultID, info } satisfies Selection
    })

    const all = Effect.fn("AgentController.all")(function* () {
      return Array.fromIterable(state.agents.values()) as Info[]
    })

    const transform = Effect.fn("AgentController.transform")(function* (fn: (draft: Draft) => void) {
      fn(makeDraft(state))
    })

    return Service.of({
      get,
      default: defaultAgent,
      resolve,
      select,
      all,
      transform,
    })
  }),
)

export { layer }
