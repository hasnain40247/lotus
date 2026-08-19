/**
 * PermissionStore — in-process store for pending tool permission requests.
 *
 * The SessionRunner reaches this through the module-level `permissionPrompter`
 * ref (set by TuiCommand at startup) so we can stay off Effect layers for the
 * runtime-configurable prompter without wiring another service into every
 * bootstrap variant. See QuestionStore for the mirror pattern.
 */

import { Effect } from "effect"

export type PermissionReply = "once" | "always" | "reject"

export interface PermissionAskInput {
  readonly sessionID: string
  readonly permission: string
  readonly patterns: ReadonlyArray<string>
  readonly always: ReadonlyArray<string>
  readonly metadata: Record<string, unknown>
  readonly tool?: { readonly messageID: string; readonly callID: string }
}

export interface PermissionRequestInfo extends PermissionAskInput {
  readonly id: string
}

export interface PermissionStoreCallbacks {
  readonly onAsk?: (req: PermissionRequestInfo) => void
  readonly onReply?: (req: PermissionRequestInfo, reply: PermissionReply) => void
}

interface Pending {
  readonly req: PermissionRequestInfo
  readonly resolve: (reply: PermissionReply) => void
}

export class PermissionStore {
  private readonly pending = new Map<string, Pending>()
  constructor(private readonly cb: PermissionStoreCallbacks = {}) {}

  ask(input: PermissionAskInput): Effect.Effect<PermissionReply> {
    return Effect.callback<PermissionReply>((resume) => {
      const id = `perm_${crypto.randomUUID()}`
      const req: PermissionRequestInfo = { ...input, id }
      this.pending.set(id, {
        req,
        resolve: (reply) => {
          this.pending.delete(id)
          resume(Effect.succeed(reply))
        },
      })
      this.cb.onAsk?.(req)
    })
  }

  list(sessionID?: string): PermissionRequestInfo[] {
    const all = [...this.pending.values()].map((p) => p.req)
    return sessionID ? all.filter((r) => r.sessionID === sessionID) : all
  }

  reply(id: string, reply: PermissionReply): void {
    const entry = this.pending.get(id)
    if (!entry) return
    entry.resolve(reply)
    this.cb.onReply?.(entry.req, reply)
  }
}

/**
 * Runtime hook for the SessionRunner. TuiCommand sets `current` after building
 * its PermissionStore; leaving it `null` preserves the legacy "ask → allow"
 * fallback so tests and non-interactive runners keep working.
 */
export const permissionPrompter: { current: PermissionStore | null } = { current: null }
