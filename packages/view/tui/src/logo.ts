import catStill from "../../../../assets/cat_still.json"
import catWave from "../../../../assets/cat_wave.json"
import catGif from "../../../../assets/cat_gif.json"

export type CatCell = {
  ch: string
  fg?: readonly [number, number, number]
  bg?: readonly [number, number, number]
}
export type CatGrid = {
  cols: number
  rows: number
  cells: readonly (readonly CatCell[])[]
}

export const nekoArt: CatGrid = catStill as unknown as CatGrid

export type CatAnim = {
  cols: number
  rows: number
  delayMs: number
  frames: readonly (readonly (readonly CatCell[])[])[]
}
export const nekoWave: CatAnim = catWave as unknown as CatAnim
export const nekoGif: CatAnim = catGif as unknown as CatAnim

const isBlankRow = (row: readonly CatCell[]) => row.every((c) => c.ch === " ")
const firstContent = nekoArt.cells.findIndex((r) => !isBlankRow(r))
const lastContent = nekoArt.cells.length - 1 - [...nekoArt.cells].reverse().findIndex((r) => !isBlankRow(r))
export const nekoCells: readonly (readonly CatCell[])[] =
  firstContent === -1 ? nekoArt.cells : nekoArt.cells.slice(firstContent, lastContent + 1)

const rawLabel = [
  "█▀▀▄ █▀▀█ █ ▄▀ █▀▀█",
  "█  █ █^^^ █▀▄  █__█",
  "▀  ▀ ▀▀▀▀ ▀ ▀▀ ▀▀▀▀",
]
// Center the label under the cat's *visual body* — the sprite isn't perfectly
// centered within its 32-cell canvas, so use body bounds instead of canvas width.
let bodyLeft = nekoArt.cols
let bodyRight = -1
for (const row of nekoCells) {
  for (let i = 0; i < row.length; i++) {
    if (row[i]!.ch !== " ") {
      if (i < bodyLeft) bodyLeft = i
      if (i > bodyRight) bodyRight = i
    }
  }
}
const bodyCenter = (bodyLeft + bodyRight) / 2
const labelPad = Math.max(0, Math.round(bodyCenter - (rawLabel[0]!.length - 1) / 2) - 4)
export const nekoLabel = rawLabel.map((line) => " ".repeat(labelPad) + line)

const toHex = (n: number) => n.toString(16).padStart(2, "0")
export const rgbHex = (rgb?: readonly [number, number, number]): string | undefined =>
  rgb ? `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}` : undefined

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
