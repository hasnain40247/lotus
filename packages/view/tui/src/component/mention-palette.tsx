import { For, Show, type Accessor } from "solid-js"
import { TextAttributes } from "@opentui/core"
import {
  C_OVERLAY_BG as C_BG,
  C_OVERLAY_BORDER as C_BORDER,
  C_OVERLAY_TEXT as C_TEXT,
  C_OVERLAY_DIM as C_DIM,
  C_OVERLAY_SELECT as C_SEL_BG,
} from "../palette"

export const MENTION_VIEWPORT = 8

export function MentionPalette(props: {
  visible: Accessor<boolean>
  query: Accessor<string>
  results: Accessor<string[]>
  selected: Accessor<number>
  scrollTop: Accessor<number>
  loading: Accessor<boolean>
}) {
  const windowed = () => props.results().slice(props.scrollTop(), props.scrollTop() + MENTION_VIEWPORT)
  const showMoreAbove = () => props.scrollTop() > 0
  const showMoreBelow = () => props.scrollTop() + MENTION_VIEWPORT < props.results().length

  const splitPath = (p: string) => {
    const idx = p.lastIndexOf("/")
    if (idx < 0) return { dir: "", name: p }
    return { dir: p.slice(0, idx + 1), name: p.slice(idx + 1) }
  }

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
          when={props.results().length > 0}
          fallback={
            <box paddingLeft={1} paddingRight={1}>
              <text fg={C_DIM}>
                {props.loading() ? "Searching…" : "No matching files"}
              </text>
            </box>
          }
        >
          <Show when={showMoreAbove()}>
            <box paddingLeft={1} paddingRight={1}>
              <text fg={C_DIM}>↑ {props.scrollTop()} more</text>
            </box>
          </Show>
          <For each={windowed()}>
            {(rel, i) => {
              const isSel = () => i() + props.scrollTop() === props.selected()
              const parts = () => splitPath(rel)
              return (
                <box
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={isSel() ? C_SEL_BG : undefined}
                >
                  <text fg={C_TEXT} attributes={TextAttributes.BOLD} flexShrink={0}>
                    {parts().name}
                  </text>
                  <text fg={C_DIM} wrapMode="none">
                    {parts().dir ? "   " + parts().dir : ""}
                  </text>
                </box>
              )
            }}
          </For>
          <Show when={showMoreBelow()}>
            <box paddingLeft={1} paddingRight={1}>
              <text fg={C_DIM}>↓ {props.results().length - props.scrollTop() - MENTION_VIEWPORT} more</text>
            </box>
          </Show>
        </Show>
        <box paddingLeft={1} paddingRight={1}>
          <text fg={C_DIM}>↑↓ navigate · tab/enter insert · esc dismiss</text>
        </box>
      </box>
    </Show>
  )
}
