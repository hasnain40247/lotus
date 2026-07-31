/**
 * Minimal ANSI-based spinner and log helpers.
 *
 * These are the only functions in this package that write to process.stderr —
 * they are intentionally kept separate from the pure formatters so that
 * callers can choose whether to invoke them.
 *
 * The spinner uses a simple frame animation over a single line; it stops and
 * clears the line when `stop()` is called.
 */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const INTERVAL_MS = 80

const PREFIX = {
  info:    "\x1b[34mℹ\x1b[0m",   // blue
  success: "\x1b[32m✔\x1b[0m",   // green
  error:   "\x1b[31m✖\x1b[0m",   // red
  warn:    "\x1b[33m⚠\x1b[0m",   // yellow
}

function writeln(line: string): void {
  process.stderr.write(line + "\n")
}

function clearLine(): void {
  // Move to column 0, clear to end of line.
  process.stderr.write("\r\x1b[K")
}

export function info(message: string): void {
  writeln(`${PREFIX.info}  ${message}`)
}

export function success(message: string): void {
  writeln(`${PREFIX.success}  ${message}`)
}

export function error(message: string): void {
  writeln(`${PREFIX.error}  ${message}`)
}

export function warn(message: string): void {
  writeln(`${PREFIX.warn}  ${message}`)
}

/**
 * Starts a spinner with `message` and returns a handle to stop it.
 *
 * @param message - The message shown while spinning.
 * @returns An object with a `stop` method.  Call `stop(finalMessage?)` to end
 *          the animation; if `finalMessage` is provided it is printed on a new line.
 */
export function spinner(message: string): { stop: (finalMessage?: string) => void } {
  // If stderr is not a TTY (e.g. piped, CI), skip animation entirely.
  if (!process.stderr.isTTY) {
    writeln(`${FRAMES[0]}  ${message}`)
    return {
      stop(finalMessage?: string) {
        if (finalMessage) writeln(finalMessage)
      },
    }
  }

  let frame = 0
  const id = setInterval(() => {
    clearLine()
    process.stderr.write(`\x1b[36m${FRAMES[frame % FRAMES.length]}\x1b[0m  ${message}`)
    frame++
  }, INTERVAL_MS)

  return {
    stop(finalMessage?: string) {
      clearInterval(id)
      clearLine()
      if (finalMessage) writeln(finalMessage)
    },
  }
}
