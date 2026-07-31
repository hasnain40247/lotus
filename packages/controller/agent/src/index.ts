/**
 * @gco/controller-agent — public surface.
 *
 * Re-exports AgentController (Effect service) and AgentRegistry (loader utilities).
 */
export { AgentController } from "./AgentController"
export { AgentRegistry } from "./AgentRegistry"

// Convenience re-exports
export {
  Service as AgentService,
  layer as agentLayer,
  defaultID as defaultAgentID,
  type Interface as AgentInterface,
  type Selection as AgentSelection,
  type Draft as AgentDraft,
  type ID as AgentID,
  type Info as AgentInfo,
} from "./AgentController"
