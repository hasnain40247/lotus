import { For, Show, type Accessor } from "solid-js"
import { RGBA, TextAttributes } from "@opentui/core"

export type ThemeName = "light" | "dark"

export type ThemePaletteItem = {
  name: ThemeName
  label: string
  description: string
  swatchBg: string
  swatchFg: string
  current?: boolean
}

export function ThemePalette(props: {
  visible: Accessor<boolean>
  items: Accessor<ThemePaletteItem[]>
  index: Accessor<number>
  // Palette colors are passed in so the modal keeps rendering readably even
  // if the active app palette shifts (theme changes require a restart, but
  // we want the modal itself to blend with whichever theme is live).
  bg: Accessor<RGBA>
  border: Accessor<RGBA>
  text: Accessor<RGBA>
  dim: Accessor<RGBA>
  selBg: Accessor<RGBA>
  accent: Accessor<RGBA>
}) {
  return (
    <Show when={props.visible()}>
      <box
        flexShrink={0}
        flexDirection="column"
        border={true}
        borderColor={props.border()}
        backgroundColor={props.bg()}
        marginBottom={0}
      >
        <box paddingLeft={1} paddingRight={1}>
          <text fg={props.accent()} attributes={TextAttributes.BOLD}>
            Theme
          </text>
        </box>
        <For each={props.items()}>
          {(item, i) => {
            const isSel = () => i() === props.index()
            return (
              <box
                flexDirection="row"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={isSel() ? props.selBg() : undefined}
              >
                <text fg={RGBA.fromHex(item.swatchFg)} bg={RGBA.fromHex(item.swatchBg)}>
                  {"  Aa  "}
                </text>
                <text fg={props.text()} attributes={TextAttributes.BOLD}>
                  {"  " + item.label.padEnd(8)}
                </text>
                <text fg={props.dim()} wrapMode="none">
                  {(item.current ? "● " : "  ") + item.description}
                </text>
              </box>
            )
          }}
        </For>
        <box paddingLeft={1} paddingRight={1}>
          <text fg={props.dim()}>
            ↑↓ navigate · enter select · esc dismiss
          </text>
        </box>
      </box>
    </Show>
  )
}
