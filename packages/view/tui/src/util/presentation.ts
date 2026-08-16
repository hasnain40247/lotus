import { nekoCells, nekoLabel } from "../logo"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"
const pink = "\x1b[38;2;232;121;164m"

function nekoWordmark(pad = "") {
  const lines = nekoCells.map((row) => {
    let s = pad
    for (const c of row) {
      let esc = ""
      if (c.fg) esc += `\x1b[38;2;${c.fg[0]};${c.fg[1]};${c.fg[2]}m`
      if (c.bg) esc += `\x1b[48;2;${c.bg[0]};${c.bg[1]};${c.bg[2]}m`
      s += esc + c.ch + reset
    }
    return s
  })
  for (const line of nekoLabel) lines.push(`${pad}${pink}${bold}${line}${reset}`)
  return lines
}

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    ...nekoWordmark("  "),
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}gco -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}
