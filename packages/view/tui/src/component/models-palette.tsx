import { For, Show, type Accessor } from "solid-js"
import { RGBA, TextAttributes } from "@opentui/core"

export type ModelsPaletteItem = {
  providerID: string
  modelID: string
  label: string
  current?: boolean
  connected?: boolean
}

export type ModelsPaletteGroup = {
  providerID: string
  heading: string
  items: ModelsPaletteItem[]
}

/**
 * Flattened row list produced from `ModelsPaletteGroup[]`. Headings are
 * non-selectable; only rows with `kind: "item"` count toward the selection
 * index (see `flattenModelGroups` in app.tsx).
 */
export type ModelsPaletteRow =
  | { kind: "heading"; heading: string; providerID: string }
  | { kind: "item"; item: ModelsPaletteItem; itemIndex: number }

export type ModelsAuthPrompt = {
  providerID: string
  providerLabel: string
} | null

export function ModelsPalette(props: {
  visible: Accessor<boolean>
  rows: Accessor<ModelsPaletteRow[]>
  itemIndex: Accessor<number>
  /**
   * When set, an "enter API key" prompt overlay appears at the bottom of the
   * palette. The main input textarea captures typing; submitting saves the key
   * and continues with the pending model selection.
   */
  authPrompt: Accessor<ModelsAuthPrompt>
  bg: Accessor<RGBA>
  border: Accessor<RGBA>
  text: Accessor<RGBA>
  dim: Accessor<RGBA>
  selBg: Accessor<RGBA>
  accent: Accessor<RGBA>
  /** Color used for the active model's indicator dot. */
  active: Accessor<RGBA>
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
            Models
          </text>
        </box>
        <For each={props.rows()}>
          {(row) => {
            if (row.kind === "heading") {
              return (
                <box flexDirection="row" paddingLeft={1} paddingRight={1} marginTop={1}>
                  <text fg={props.dim()} attributes={TextAttributes.BOLD}>
                    {row.heading}
                  </text>
                </box>
              )
            }
            const isSel = () => row.itemIndex === props.itemIndex()
            // Dot color encodes state: accent = currently active, dim = connected
            // but not current, empty slot = provider not connected. So the active
            // model is always visually distinct from the other connected options.
            const dotColor = () =>
              row.item.current ? props.active() : row.item.connected ? props.dim() : undefined
            const dotChar = () => (row.item.current || row.item.connected ? "● " : "  ")
            return (
              <box
                flexDirection="row"
                paddingLeft={3}
                paddingRight={1}
                backgroundColor={isSel() ? props.selBg() : undefined}
              >
                <text fg={dotColor()}>{dotChar()}</text>
                <text
                  fg={props.text()}
                  attributes={row.item.current ? TextAttributes.BOLD : undefined}
                >
                  {row.item.label}
                </text>
              </box>
            )
          }}
        </For>
        <Show
          when={props.authPrompt()}
          fallback={
            <box paddingLeft={1} paddingRight={1}>
              <text fg={props.dim()}>
                ↑↓ navigate · enter select · esc dismiss
              </text>
            </box>
          }
        >
          {(prompt) => (
            <>
              <box flexDirection="row" paddingLeft={1} paddingRight={1} marginTop={1}>
                <text fg={props.accent()} attributes={TextAttributes.BOLD}>
                  {"Enter " + prompt().providerLabel + " API key"}
                </text>
              </box>
              <box paddingLeft={1} paddingRight={1}>
                <text fg={props.dim()}>
                  type in the prompt below · enter save · esc cancel
                </text>
              </box>
            </>
          )}
        </Show>
      </box>
    </Show>
  )
}
