/**
 * AgentRegistry — loads and merges built-in agent definitions with any
 * user-supplied overrides read from lotus-code.json (or equivalent config).
 *
 * Ported from:
 *   packages/core/src/plugin/agent.ts   — built-in agents + system prompts
 *   packages/core/src/agent.ts          — agent model / state helpers
 */
export * as AgentRegistry from "./AgentRegistry"

import { Agent, Permission } from "@gco/schema"

// ---------------------------------------------------------------------------
// Built-in system prompts
// ---------------------------------------------------------------------------

const PROMPT_BUILD = `You are lotus-code, an AI coding agent working in a terminal alongside the user.

Help the user accomplish software engineering tasks by inspecting the workspace, making targeted changes, and using tools according to the configured permissions.

## How to respond to the user

- Every turn must end with a natural-language message addressed to the user. After a tool runs, respond in prose — do not stop at the tool result. Silence looks like a bug to the user.
- Assume the user cannot easily read raw tool output (JSON blobs, long file dumps, search results). Summarize the meaningful parts: what you found, what it means, and what you did or plan to do next. Reference key details (file paths, function names, counts) directly in your prose.
- Be concise. One or two short paragraphs is usually right. Skip filler like "I'll now..." or "Let me...". Just do the work and report the result.
- When referring to code, use \`file/path.ts:line\` so the user can jump to it.

## How to use tools

- Prefer the most direct tool for the job: \`read\` to view a file, \`edit\` for surgical changes, \`write\` for whole-file creation, \`grep\`/\`glob\` for search, \`bash\` for shell operations, \`web_search\`/\`web_fetch\` for the internet.
- Chain tools as needed to complete the task before responding.
- If a tool fails or returns an error result, tell the user what happened and what you'd like to try next rather than silently retrying forever.

## Conventions

- Match the style and patterns already present in the codebase.
- Do not add comments explaining what code does when names already make it obvious.
- Do not create files (READMEs, docs, plans) unless the user asks for them.
- Do not commit or push changes unless the user explicitly asks.`

const PROMPT_EXPLORE = `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- Do not create any files, or run bash commands that modify the user's system state in any way

Complete the user's search request efficiently and report your findings clearly.`

export const PROMPT_COMPACTION = `You are an anchored context summarization assistant for coding sessions.

Summarize only the conversation history you are given. The newest turns may be kept verbatim outside your summary, so focus on the older context that still matters for continuing the work.

If the prompt includes a <previous-summary> block, treat it as the current anchored summary. Update it with the new history by preserving still-true details, removing stale details, and merging in new facts.

Always follow the exact output structure requested by the user prompt. Keep every section, preserve exact file paths and identifiers when known, and prefer terse bullets over paragraphs.

Do not answer the conversation itself. Do not mention that you are summarizing, compacting, or merging context. Respond in the same language as the conversation.`

export const PROMPT_TITLE = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- <=50 characters
- No explanations
</task>

<rules>
- you MUST use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally - no word salad
- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
- Focus on the main topic or question the user needs to retrieve
- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
  -> create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" -> Debugging production 500 errors
"refactor user service" -> Refactoring user service
"why is app.js failing" -> app.js failure investigation
"implement rate limiting" -> Rate limiting implementation
"how do I connect postgres to my API" -> Postgres API connection
"best practices for React hooks" -> React hooks best practices
"@src/credential.ts can you add refresh token support" -> Credential refresh token support
"@utils/parser.ts this is broken" -> Parser bug fix
"look at @config.json" -> Config review
"@App.tsx add dark mode toggle" -> Dark mode toggle in App
</examples>`

const PROMPT_SUMMARY = `Summarize what was done in this conversation. Write like a pull request description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or other validation steps
- Do not explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions or add new questions
- If the conversation ends with an unanswered question to the user, preserve that exact question
- If the conversation ends with an imperative statement or request to the user (e.g. "Now please run the command and paste the console output"), always include that exact request in the summary`

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

/** Merge a base ruleset with an override set, replacing on matching action+resource. */
export function mergePermissions(
  base: Permission.Ruleset,
  overrides: Permission.Ruleset,
): Permission.Ruleset {
  const result: Permission.Rule[] = [...base]
  for (const override of overrides) {
    const idx = result.findIndex((r) => r.action === override.action && r.resource === override.resource)
    if (idx >= 0) {
      result[idx] = override
    } else {
      result.push(override)
    }
  }
  return result
}

const defaultPermissions: Permission.Ruleset = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "external_directory", resource: "*", effect: "ask" },
  { action: "question", resource: "*", effect: "deny" },
  { action: "plan_enter", resource: "*", effect: "deny" },
  { action: "plan_exit", resource: "*", effect: "deny" },
  { action: "read", resource: "*", effect: "allow" },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
]

// ---------------------------------------------------------------------------
// Helpers for constructing Agent.Info plain objects
// ---------------------------------------------------------------------------

export const BUILT_IN_IDS = ["build", "explore", "plan", "general", "compaction", "title", "summary"] as const
export type BuiltInID = (typeof BUILT_IN_IDS)[number]

function makeID(id: string): Agent.ID {
  return Agent.ID.make(id)
}

/** Empty agent info — provides required fields that optional ones default to. */
function emptyAgent(id: Agent.ID): Agent.Info {
  return {
    id,
    request: { headers: {}, body: {} },
    mode: "all",
    hidden: false,
    permissions: [],
  }
}

function buildAgent(): Agent.Info {
  return {
    ...emptyAgent(makeID("build")),
    system: PROMPT_BUILD,
    description: "The default agent. Executes tools based on configured permissions.",
    mode: "primary",
    permissions: mergePermissions(defaultPermissions, [
      { action: "question", resource: "*", effect: "allow" },
      { action: "plan_enter", resource: "*", effect: "allow" },
    ]),
  }
}

function exploreAgent(): Agent.Info {
  return {
    ...emptyAgent(makeID("explore")),
    system: PROMPT_EXPLORE,
    description:
      'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.',
    mode: "subagent",
    permissions: mergePermissions(defaultPermissions, [
      { action: "*", resource: "*", effect: "deny" },
      { action: "grep", resource: "*", effect: "allow" },
      { action: "glob", resource: "*", effect: "allow" },
      { action: "webfetch", resource: "*", effect: "allow" },
      { action: "websearch", resource: "*", effect: "allow" },
      { action: "read", resource: "*", effect: "allow" },
    ]),
  }
}

function planAgent(): Agent.Info {
  return {
    ...emptyAgent(makeID("plan")),
    description: "Plan mode. Disallows all edit tools.",
    mode: "primary",
    permissions: mergePermissions(defaultPermissions, [
      { action: "question", resource: "*", effect: "allow" },
      { action: "plan_exit", resource: "*", effect: "allow" },
      { action: "edit", resource: "*", effect: "deny" },
    ]),
  }
}

function generalAgent(): Agent.Info {
  return {
    ...emptyAgent(makeID("general")),
    description:
      "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.",
    mode: "subagent",
    permissions: mergePermissions(defaultPermissions, [
      { action: "todowrite", resource: "*", effect: "deny" },
    ]),
  }
}

function compactionAgent(): Agent.Info {
  return {
    ...emptyAgent(makeID("compaction")),
    system: PROMPT_COMPACTION,
    mode: "primary",
    hidden: true,
    permissions: mergePermissions(defaultPermissions, [
      { action: "*", resource: "*", effect: "deny" },
    ]),
  }
}

function titleAgent(): Agent.Info {
  return {
    ...emptyAgent(makeID("title")),
    system: PROMPT_TITLE,
    mode: "primary",
    hidden: true,
    permissions: mergePermissions(defaultPermissions, [
      { action: "*", resource: "*", effect: "deny" },
    ]),
  }
}

function summaryAgent(): Agent.Info {
  return {
    ...emptyAgent(makeID("summary")),
    system: PROMPT_SUMMARY,
    mode: "primary",
    hidden: true,
    permissions: mergePermissions(defaultPermissions, [
      { action: "*", resource: "*", effect: "deny" },
    ]),
  }
}

/** Return a fresh map of all built-in agent definitions. */
export function builtInAgents(): Map<Agent.ID, Agent.Info> {
  const agents = new Map<Agent.ID, Agent.Info>()
  for (const info of [
    buildAgent(),
    exploreAgent(),
    planAgent(),
    generalAgent(),
    compactionAgent(),
    titleAgent(),
    summaryAgent(),
  ]) {
    agents.set(info.id, info)
  }
  return agents
}

// ---------------------------------------------------------------------------
// Agent override shape (from lotus-code.json / project config)
// ---------------------------------------------------------------------------

export interface AgentOverride {
  readonly model?: string
  readonly system?: string
  readonly description?: string
  readonly mode?: "subagent" | "primary" | "all"
  readonly hidden?: boolean
  readonly steps?: number
  readonly disabled?: boolean
  readonly permissions?: Permission.Ruleset
}

/**
 * Merge user-supplied overrides on top of the built-in agents map.
 *
 * @param overrides  Record read from the `agents` block of lotus-code.json.
 * @returns          A new Map merging built-ins with user overrides.
 */
export function merge(overrides: Record<string, AgentOverride>): Map<Agent.ID, Agent.Info> {
  const agents = builtInAgents()

  for (const [key, override] of Object.entries(overrides)) {
    if (override.disabled) {
      agents.delete(makeID(key))
      continue
    }

    const id = makeID(key)
    const existing: Agent.Info = agents.get(id) ?? emptyAgent(id)

    const updated: Agent.Info = {
      ...existing,
      ...(override.system !== undefined ? { system: override.system } : {}),
      ...(override.description !== undefined ? { description: override.description } : {}),
      ...(override.mode !== undefined ? { mode: override.mode } : {}),
      ...(override.hidden !== undefined ? { hidden: override.hidden } : {}),
      ...(override.steps !== undefined ? { steps: override.steps } : {}),
      ...(override.permissions !== undefined
        ? { permissions: mergePermissions(existing.permissions, override.permissions) }
        : {}),
    }

    agents.set(id, updated)
  }

  return agents
}
