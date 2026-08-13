import { For, Show, type Accessor } from "solid-js"
import { SlashCommand as SlashCommandSchema } from "@gco/schema"
import {
  C_OVERLAY_BG as C_BG,
  C_OVERLAY_BORDER as C_BORDER,
  C_OVERLAY_TEXT as C_TEXT,
  C_OVERLAY_DIM as C_DIM,
  C_OVERLAY_SELECT as C_SEL_BG,
} from "../palette"

export type SlashCommand = SlashCommandSchema.Info
export const SLASH_COMMANDS: readonly SlashCommand[] = SlashCommandSchema.registry

export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...SLASH_COMMANDS].sort((a, b) => a.name.localeCompare(b.name))

  const matches: Array<{ cmd: SlashCommand; score: number }> = []
  for (const cmd of SLASH_COMMANDS) {
    const names = [cmd.name, ...(cmd.aliases ?? [])]
    let best = -1
    for (const n of names) {
      const lower = n.toLowerCase()
      if (lower === q) best = Math.max(best, 3)
      else if (lower.startsWith(q)) best = Math.max(best, 2)
      else if (lower.includes(q)) best = Math.max(best, 1)
    }
    if (best >= 0) matches.push({ cmd, score: best })
  }
  matches.sort((a, b) => b.score - a.score || a.cmd.name.localeCompare(b.cmd.name))
  return matches.map((m) => m.cmd)
}

export const PALETTE_VIEWPORT = 8

export function SlashPalette(props: {
  visible: Accessor<boolean>
  commands: Accessor<SlashCommand[]>
  selected: Accessor<number>
  scrollTop: Accessor<number>
  maxNameWidth?: number
}) {
  const namePad = () => {
    if (props.maxNameWidth) return props.maxNameWidth
    let max = 0
    for (const c of props.commands()) if (c.name.length > max) max = c.name.length
    return max + 1
  }

  const windowed = () => props.commands().slice(props.scrollTop(), props.scrollTop() + PALETTE_VIEWPORT)
  const showMoreAbove = () => props.scrollTop() > 0
  const showMoreBelow = () => props.scrollTop() + PALETTE_VIEWPORT < props.commands().length

  return (
    <Show when={props.visible()}>
      <box
        flexShrink={0}
        flexDirection="column"
        border={true}
        borderColor={C_BORDER}
        backgroundColor={C_BG}
        marginBottom={0}
      >
        <Show
          when={props.commands().length > 0}
          fallback={
            <box paddingLeft={1} paddingRight={1}>
              <text fg={C_DIM}>No matching commands</text>
            </box>
          }
        >
          <Show when={showMoreAbove()}>
            <box paddingLeft={1} paddingRight={1}>
              <text fg={C_DIM}>↑ {props.scrollTop()} more</text>
            </box>
          </Show>
          <For each={windowed()}>
            {(cmd, i) => {
              const isSel = () => i() + props.scrollTop() === props.selected()
              return (
                <box
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={isSel() ? C_SEL_BG : undefined}
                >
                  <text fg={C_TEXT} flexShrink={0}>
                    {("/" + cmd.name).padEnd(namePad() + 1)}
                  </text>
                  <text fg={C_DIM} wrapMode="none">
                    {cmd.description}
                  </text>
                </box>
              )
            }}
          </For>
          <Show when={showMoreBelow()}>
            <box paddingLeft={1} paddingRight={1}>
              <text fg={C_DIM}>↓ {props.commands().length - props.scrollTop() - PALETTE_VIEWPORT} more</text>
            </box>
          </Show>
        </Show>
        <box paddingLeft={1} paddingRight={1}>
          <text fg={C_DIM}>↑↓ navigate · tab/enter complete · esc dismiss</text>
        </box>
      </box>
    </Show>
  )
}
