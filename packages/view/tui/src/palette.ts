/**
 * palette.ts — shared theme palette for the TUI.
 *
 * Reads ~/.neko/config.json synchronously at module load to pick the
 * active theme (light | dark). Both app.tsx and the overlay components
 * (slash/mention/agent/mcp/theme palettes) import from here so a theme
 * switch flows through everywhere on next launch.
 */

import { RGBA } from "@opentui/core"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export type ThemeName = "light" | "dark"

export type Palette = {
  bg: string        // surface bg
  egg: string       // primary text
  white: string     // strongest text (user messages)
  dim: string       // muted / hint text
  muted: string     // borders, dividers
  input: string     // input textarea bg — also the overlay panel bg
  accent: string    // running indicator, palette headers, wordmarks
  userBg: string    // user message bubble — also the palette selected row bg
}

export const LIGHT_PALETTE: Palette = {
  bg:     "#F5F1E8",
  egg:    "#1A1A1A",
  white:  "#000000",
  dim:    "#6B5D45",
  muted:  "#C8B896",
  input:  "#EEE7D5",
  accent: "#8B7355",
  userBg: "#DBCFB0",
}

export const DARK_PALETTE: Palette = {
  bg:     "#222222",
  egg:    "#E5D9BE",
  white:  "#F5EFDC",
  dim:    "#8F8577",
  muted:  "#3A3835",
  input:  "#2D2D2D",
  accent: "#C8B896",
  userBg: "#333330",
}

export const GLOBAL_CONFIG_PATH = path.join(os.homedir(), ".neko", "config.json")

export function readGlobalConfig(): { theme?: ThemeName } {
  try {
    return JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, "utf8"))
  } catch {
    return {}
  }
}

export const ACTIVE_THEME: ThemeName = readGlobalConfig().theme === "dark" ? "dark" : "light"
export const PALETTE: Palette = ACTIVE_THEME === "dark" ? DARK_PALETTE : LIGHT_PALETTE

// Convenience RGBA constants — same names the palette components already use.
export const C_BG      = RGBA.fromHex(PALETTE.bg)
export const C_EGG     = RGBA.fromHex(PALETTE.egg)
export const C_WHITE   = RGBA.fromHex(PALETTE.white)
export const C_DIM     = RGBA.fromHex(PALETTE.dim)
export const C_MUTED   = RGBA.fromHex(PALETTE.muted)
export const C_INPUT   = RGBA.fromHex(PALETTE.input)
export const C_ACCENT  = RGBA.fromHex(PALETTE.accent)
export const C_USER_BG = RGBA.fromHex(PALETTE.userBg)

// Semantic "on / active" indicator — used for the active model dot in /models.
// Kept a single fixed green (rather than theme-varied) so users read it as
// unambiguously "on" in either light or dark mode.
export const C_ACTIVE = RGBA.fromHex("#22c55e")

// Overlay aliases — same visual role, semantic names used by palette components.
export const C_OVERLAY_BG      = C_INPUT     // panel background
export const C_OVERLAY_BORDER  = C_MUTED     // panel border
export const C_OVERLAY_TEXT    = C_EGG       // primary text inside panel
export const C_OVERLAY_DIM     = C_DIM       // hint/description text
export const C_OVERLAY_SELECT  = C_USER_BG   // selected row bg
export const C_OVERLAY_ACCENT  = C_ACCENT    // panel title
