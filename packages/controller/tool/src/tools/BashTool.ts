/**
 * BashTool — shell command execution.
 *
 * Ported from @neko/core tool/bash.ts.
 * Logic is kept identical: 2-minute default timeout, 10-minute max, 1 MB output cap.
 */
export * as BashTool from "./BashTool"

import path from "path"
import { Duration, Effect, Schema } from "effect"
import { ToolFailure, make as makeTool, type AnyTool } from "../Tool"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const name = "bash"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000
export const MAX_TIMEOUT_MS = 10 * 60 * 1_000
export const MAX_CAPTURE_BYTES = 1024 * 1024

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const Input = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.String.pipe(Schema.optional).annotate({
    description:
      "Working directory. Defaults to the process working directory; relative paths resolve from that directory.",
  }),
  timeout: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_TIMEOUT_MS))
    .pipe(Schema.optional)
    .annotate({
      description: `Timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS} and may not exceed ${MAX_TIMEOUT_MS}.`,
    }),
})

const StructuredOutput = Schema.Struct({
  exit: Schema.Number.pipe(Schema.optional),
  truncated: Schema.Boolean,
  timeout: Schema.Boolean.pipe(Schema.optional),
})

const Output = Schema.Struct({
  ...StructuredOutput.fields,
  output: Schema.String,
  warnings: Schema.Array(Schema.String).pipe(Schema.optional),
})

type OutputType = typeof Output.Type

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultShell = () =>
  process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh"

const shellTokens = (command: string) =>
  command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []

const unquote = (value: string) => value.replace(/^(['"])(.*)\1$/, "$2")

function externalCommandDirectories(command: string, cwd: string): string[] {
  const directories = new Set<string>()
  for (const token of shellTokens(command)) {
    const value = unquote(token).replace(/[;,|&]+$/, "")
    if (!path.isAbsolute(value)) continue
    const resolved = path.resolve(value)
    if (resolved.startsWith(cwd + path.sep) || resolved === cwd) continue
    directories.add(path.dirname(resolved))
  }
  return [...directories]
}

const modelOutput = (output: OutputType) => {
  const warnings = output.warnings?.length
    ? `\n\nWarnings:\n${output.warnings.map((w) => `- ${w}`).join("\n")}`
    : ""
  if (output.timeout) return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command timed out before completion.`
  return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command exited with code ${output.exit}.`
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

function executeCommand(
  command: string,
  cwd: string,
  shell: string,
  timeoutMs: number,
): Promise<{ exitCode: number | null; output: string; outputTruncated: boolean } | null> {
  return new Promise((resolve) => {
    const { spawn } = require("child_process") as typeof import("child_process")
    let done = false
    let captured = Buffer.alloc(0)
    let truncated = false

    const child = spawn(command, [], {
      cwd,
      shell,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })

    const onData = (chunk: Buffer) => {
      if (done) return
      const remaining = MAX_CAPTURE_BYTES - captured.length
      if (remaining <= 0) {
        truncated = true
        return
      }
      if (chunk.length > remaining) {
        captured = Buffer.concat([captured, chunk.subarray(0, remaining)])
        truncated = true
      } else {
        captured = Buffer.concat([captured, chunk])
      }
    }

    child.stdout?.on("data", onData)
    child.stderr?.on("data", onData)

    const timer = setTimeout(() => {
      if (done) return
      done = true
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL")
        else child.kill("SIGKILL")
      } catch {}
      resolve(null)
    }, timeoutMs)

    child.on("close", (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ exitCode: code, output: captured.toString("utf8"), outputTruncated: truncated })
    })

    child.on("error", () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ exitCode: null, output: "", outputTruncated: false })
    })
  })
}

export const tool: AnyTool = makeTool({
  description: `Execute one shell command string with the host user's filesystem, process, and network authority. The working directory is the active location. Relative workdir values resolve from that location. Timeout values are milliseconds (default: ${DEFAULT_TIMEOUT_MS}; maximum: ${MAX_TIMEOUT_MS}). Uses /bin/sh on POSIX and COMSPEC or cmd.exe on Windows.`,
  input: Input,
  output: Output,
  structured: StructuredOutput,
  toStructuredOutput: ({ output }) => ({
    truncated: output.truncated,
    ...(output.exit === undefined ? {} : { exit: output.exit }),
    ...(output.timeout === undefined ? {} : { timeout: output.timeout }),
  }),
  toModelOutput: ({ output }) => [
    { type: "text", text: output.output },
    { type: "text", text: modelOutput(output) },
  ],
  execute: (input, _context) =>
    Effect.gen(function* () {
      const cwd = input.workdir ? path.resolve(input.workdir) : process.cwd()
      const shell = defaultShell()
      const timeoutMs = input.timeout ?? DEFAULT_TIMEOUT_MS

      const warnings = externalCommandDirectories(input.command, cwd).map(
        (directory) =>
          `Command argument references external directory ${path.join(directory, "*").replaceAll("\\", "/")}. Bash runs with host-user filesystem, process, and network authority; this scan is advisory only.`,
      )

      const result = yield* Effect.promise(() => executeCommand(input.command, cwd, shell, timeoutMs))

      if (!result) {
        return {
          output: `Command exceeded timeout of ${timeoutMs} ms. Retry with a larger timeout if the command is expected to take longer.`,
          truncated: false,
          timeout: true,
          ...(warnings.length ? { warnings } : {}),
        }
      }

      const output = result.output || "(no output)"
      const notice = result.outputTruncated
        ? "[output capture truncated at the in-memory safety limit]"
        : undefined
      return {
        exit: result.exitCode ?? undefined,
        output: notice ? `${output}\n\n${notice}` : output,
        truncated: result.outputTruncated,
        ...(warnings.length ? { warnings } : {}),
      }
    }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to execute command: ${input.command}` }))),
})
