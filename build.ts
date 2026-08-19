#!/usr/bin/env bun
/**
 * Build neko as a standalone binary.
 *
 * Uses OpenTUI's Solid transform plugin at build time so JSX in packages/view/tui
 * gets lowered before bundling — the same plugin preload.ts registers at runtime.
 */

import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const TARGET = process.env.BUILD_TARGET ?? "bun-darwin-arm64"
const OUTFILE = process.env.BUILD_OUTFILE ?? "./dist/neko"

console.log(`[build] target=${TARGET} outfile=${OUTFILE}`)

const result = await Bun.build({
  entrypoints: ["packages/controller/cli/src/index.ts"],
  compile: {
    target: TARGET as `bun-${string}`,
    outfile: OUTFILE,
  },
  plugins: [createSolidTransformPlugin()],
})

if (!result.success) {
  console.error("[build] failed:")
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log(`[build] wrote ${OUTFILE}`)
