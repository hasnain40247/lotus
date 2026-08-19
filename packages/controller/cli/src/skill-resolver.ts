/**
 * Skill resolution — layered lookup across two locations:
 *
 *   1. ./skills/<name>.md              (project-local, checked into repo)
 *   2. $XDG_CONFIG_HOME/neko/skills/<name>.md  (user-global, defaults to ~/.config/neko/skills)
 *
 * Project entries win on name collisions. Frontmatter follows a small
 * `---`-fenced YAML-lite convention: only top-level `key: value` pairs on
 * their own lines. We only care about `description` for the palette.
 */

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

export interface Skill {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly body: string
  readonly source: "project" | "user"
  readonly path: string
}

// ── Path resolution ──────────────────────────────────────────────────────────

export function projectSkillsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, "skills")
}

export function userSkillsDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".config")
  return path.join(base, "neko", "skills")
}

// ── Frontmatter ──────────────────────────────────────────────────────────────

/**
 * Split a skill file into `{ frontmatter, body }`. If the file doesn't
 * start with `---`, the whole content is body and frontmatter is empty.
 */
function splitFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { meta: {}, body: content }
  }
  const rest = content.slice(content.indexOf("\n") + 1)
  const endIdx = rest.search(/^---\s*$/m)
  if (endIdx === -1) return { meta: {}, body: content }
  const header = rest.slice(0, endIdx)
  const body = rest.slice(endIdx + rest.slice(endIdx).indexOf("\n") + 1)
  const meta: Record<string, string> = {}
  for (const line of header.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/)
    if (m) meta[m[1]!.toLowerCase()] = m[2]!.replace(/^["']|["']$/g, "").trim()
  }
  return { meta, body: body.trimStart() }
}

// ── Public API ───────────────────────────────────────────────────────────────

async function readSkill(
  filePath: string,
  source: "project" | "user",
): Promise<Skill | undefined> {
  const stat = await fs.stat(filePath).catch(() => undefined)
  if (!stat?.isFile()) return undefined
  const content = await fs.readFile(filePath, "utf-8")
  const { meta, body } = splitFrontmatter(content)
  const name = path.basename(filePath, ".md")
  const fallback = body.split("\n").find((l) => l.trim()) ?? ""
  return {
    id: name,
    name,
    description: meta.description ?? fallback,
    body,
    source,
    path: filePath,
  }
}

/**
 * Resolve a skill by name using layered lookup. Project wins over user.
 */
export async function resolveSkill(
  name: string,
  cwd: string = process.cwd(),
): Promise<Skill | undefined> {
  const projectPath = path.join(projectSkillsDir(cwd), `${name}.md`)
  const project = await readSkill(projectPath, "project")
  if (project) return project
  const userPath = path.join(userSkillsDir(), `${name}.md`)
  return await readSkill(userPath, "user")
}

async function listDir(dir: string, source: "project" | "user"): Promise<Skill[]> {
  const entries = await fs.readdir(dir).catch(() => [] as string[])
  const skills: Skill[] = []
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue
    const skill = await readSkill(path.join(dir, entry), source)
    if (skill) skills.push(skill)
  }
  return skills
}

/**
 * List all available skills. Project entries override user-global ones with
 * the same name.
 */
export async function listAllSkills(cwd: string = process.cwd()): Promise<Skill[]> {
  const [projectSkills, userSkills] = await Promise.all([
    listDir(projectSkillsDir(cwd), "project"),
    listDir(userSkillsDir(), "user"),
  ])
  const merged = new Map<string, Skill>()
  for (const s of userSkills) merged.set(s.name, s)
  for (const s of projectSkills) merged.set(s.name, s) // project wins
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
}
