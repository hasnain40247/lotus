import { Context, Effect } from "effect"
import type { Project } from "@gco/schema"

/**
 * Repository for project metadata.
 *
 * A project corresponds to a local directory tree (typically a git worktree).
 * Project records are created the first time a session is started in a directory.
 */
export interface IProjectRepository {
  /** Return a project by ID, or undefined if it does not exist. */
  get(id: Project.ID): Effect.Effect<Project.Info | undefined, Error>

  /** Return a project by its worktree directory path, or undefined. */
  getByWorktree(worktree: string): Effect.Effect<Project.Info | undefined, Error>

  /** Return all stored projects. */
  list(): Effect.Effect<Project.Info[], Error>

  /**
   * Persist a new project record.
   * If a project with the same ID already exists, implementations should
   * treat this as a no-op (idempotent create).
   */
  create(info: Project.Info): Effect.Effect<void, Error>

  /** Apply a partial update to an existing project. */
  update(id: Project.ID, patch: Partial<Project.Info>): Effect.Effect<void, Error>
}

export class ProjectRepository extends Context.Service<ProjectRepository, IProjectRepository>()("ProjectRepository") {}
