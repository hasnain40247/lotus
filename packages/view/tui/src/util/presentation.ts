import { lotusArt } from "../logo"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"
const pink = "\x1b[38;2;232;121;164m"

function lotusWordmark(pad = "") {
  const lines = lotusArt.map((row) => `${pad}${pink}${row}${reset}`)
  lines.push(`${pad}${pink}${bold}L O T U S${reset}`)
  return lines
}

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    ...lotusWordmark("  "),
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}gco -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}
