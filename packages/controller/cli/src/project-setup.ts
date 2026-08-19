import { Effect } from "effect"
import { Project } from "@gco/schema"
import { ProjectRepository } from "@gco/model-domain"

/**
 * Derive the project ID for a directory.
 * `encodeURIComponent(directory)` keeps continuity with sessions that
 * already carry this scheme in `session.projectID`.
 */
export function deriveProjectID(directory: string): Project.ID {
  return encodeURIComponent(directory) as Project.ID
}

/**
 * Ensure a project record exists for the given directory. Returns the
 * `Project.Info` — either the existing doc or a freshly created one.
 * Idempotent — safe to call every startup.
 */
export const ensureProject = (
  directory: string,
): Effect.Effect<Project.Info, Error, ProjectRepository> =>
  Effect.gen(function* () {
    const repo = yield* ProjectRepository
    const id = deriveProjectID(directory)

    const existing = yield* repo.get(id)
    if (existing) return existing

    const now = Date.now()
    const info: Project.Info = {
      id,
      worktree: directory,
      time: { created: now, updated: now },
      sandboxes: [],
    }
    yield* repo.create(info)
    return info
  })
