import { For, Show, type Accessor } from "solid-js"
import { TextAttributes } from "@opentui/core"
import {
  C_OVERLAY_BG as C_BG,
  C_OVERLAY_BORDER as C_BORDER,
  C_OVERLAY_TEXT as C_TEXT,
  C_OVERLAY_DIM as C_DIM,
  C_OVERLAY_SELECT as C_SEL_BG,
  C_OVERLAY_ACCENT as C_ACCENT,
} from "../palette"

export type SkillPaletteItem = {
  readonly name: string
  readonly description: string
}

/**
 * Modal-style palette for browsing and selecting a skill, mirroring the
 * shape of AgentPalette. Selection is a flat index; the parent owns key
 * intercepts and forwards ↑/↓/Enter/Esc.
 */
export function SkillsPalette(props: {
  visible: Accessor<boolean>
  items: Accessor<SkillPaletteItem[]>
  index: Accessor<number>
}) {
  const namePad = () => {
    let max = 0
    for (const it of props.items()) if (it.name.length > max) max = it.name.length
    return max + 1
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
        <box paddingLeft={1} paddingRight={1}>
          <text fg={C_ACCENT} attributes={TextAttributes.BOLD}>
            Skills
          </text>
        </box>

        <Show
          when={props.items().length > 0}
          fallback={
            <box paddingLeft={1} paddingRight={1}>
              <text fg={C_DIM}>
                No skills yet. Run `neko skill create &lt;name&gt;` to add one.
              </text>
            </box>
          }
        >
          <For each={props.items()}>
            {(item, i) => {
              const isSel = () => i() === props.index()
              return (
                <box
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={isSel() ? C_SEL_BG : undefined}
                >
                  <text fg={C_TEXT} flexShrink={0}>
                    {("/" + item.name).padEnd(namePad() + 1)}
                  </text>
                  <text fg={C_DIM} wrapMode="none">
                    {item.description}
                  </text>
                </box>
              )
            }}
          </For>
        </Show>

        <box paddingLeft={1} paddingRight={1}>
          <text fg={C_DIM}>↑↓ navigate · enter insert · esc dismiss</text>
        </box>
      </box>
    </Show>
  )
}
