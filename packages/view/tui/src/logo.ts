import catStill from "../../../../assets/cat_still.json"
import catWave from "../../../../assets/cat_wave.json"
import catGif from "../../../../assets/cat_gif.json"
import catLandingNew from "../../../../assets/cat_landing_new.json"

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

// The landing hero: a 10-frame animated cat sourced from cat_landing_new.json.
export const nekoLanding: CatAnim = catLandingNew as unknown as CatAnim

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
// Center the label under a cat sprite's *visual body*. Sprites aren't
// necessarily centered inside their canvas, so we scan for the leftmost/
// rightmost non-blank column across all provided rows. `nudge` shifts the
// resulting padding — the still cat needed a -4 correction; the tightly
// cropped landing cat needs none.
function centerLabelUnder(
  cells: readonly (readonly CatCell[])[],
  canvasCols: number,
  nudge = 0,
): string[] {
  let bodyLeft = canvasCols
  let bodyRight = -1
  for (const row of cells) {
    for (let i = 0; i < row.length; i++) {
      if (row[i]!.ch !== " ") {
        if (i < bodyLeft) bodyLeft = i
        if (i > bodyRight) bodyRight = i
      }
    }
  }
  const bodyCenter = (bodyLeft + bodyRight) / 2
  const labelLen = rawLabel[0]!.length
  const rawPad = Math.round(bodyCenter - (labelLen - 1) / 2) + nudge

  // Positive: leading spaces shift the visible label right (in a flex column
  // with alignItems="center", each leading space shifts the visible content
  // right by 0.5 col — but since padding is symmetric relative to shortening,
  // this behaves like normal left-padding relative to the sibling cat).
  if (rawPad >= 0) {
    return rawLabel.map((line) => " ".repeat(rawPad) + line)
  }
  // Negative: the container centers each child independently, so leading
  // spaces would still bottom out at the label being centered. To move the
  // visible label further LEFT than the cat's leftmost column, extend it
  // rightward with trailing spaces — each 2 trailing spaces shift the visible
  // content 1 col left under center alignment.
  const trailing = -rawPad * 2
  return rawLabel.map((line) => line + " ".repeat(trailing))
}
export const nekoLabel = centerLabelUnder(nekoCells, nekoArt.cols, -4)

// Landing-hero label: use frame 0 (body bounds are stable across frames).
// Nudge -6 to shift the label six columns left of body-center.
export const nekoLandingLabel = centerLabelUnder(
  nekoLanding.frames[0]!,
  nekoLanding.cols,
  -6,
)

const toHex = (n: number) => n.toString(16).padStart(2, "0")
export const rgbHex = (rgb?: readonly [number, number, number]): string | undefined =>
  rgb ? `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}` : undefined

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
