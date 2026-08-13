import { For, Show, type Accessor } from "solid-js"
import { RGBA, TextAttributes } from "@opentui/core"

const C_BORDER = RGBA.fromHex("#C8B896")
const C_BG     = RGBA.fromHex("#EEE7D5")
const C_TEXT   = RGBA.fromHex("#1A1A1A")
const C_DIM    = RGBA.fromHex("#6B5D45")
const C_SEL_BG = RGBA.fromHex("#DBCFB0")
const C_ACCENT = RGBA.fromHex("#8B7355")

export type AgentPaletteItem = {
  name: string
  description?: string
  color?: string
  current?: boolean
  deletable?: boolean
}

export type AgentPalettePhase =
  | { type: "select"; items: AgentPaletteItem[]; index: number }
  | { type: "create"; step: "name" | "description" | "mode"; name?: string; description?: string }
  | { type: "confirm"; name: string; returnIndex: number; items: AgentPaletteItem[] }

export function AgentPalette(props: {
  visible: Accessor<boolean>
  phase: Accessor<AgentPalettePhase>
  agentColor: (name: string) => any
}) {
  return (
    <Show when={props.visible()}>
      <box
        flexShrink={0}
        flexDirection="column"
        border={true}
        borderColor={C_BORDER}
        backgroundColor={C_BG}
        marginLeft={2}
        marginRight={2}
        marginBottom={0}
      >
        <box paddingLeft={1} paddingRight={1}>
          <text fg={C_ACCENT} attributes={TextAttributes.BOLD}>
            {props.phase().type === "select"
              ? "Agents"
              : props.phase().type === "create"
                ? "Create new agent"
                : "Confirm delete"}
          </text>
        </box>

        <Show when={props.phase().type === "select"}>
          {(() => {
            const p = props.phase() as Extract<AgentPalettePhase, { type: "select" }>
            return (
              <>
                <For each={p.items}>
                  {(item, i) => {
                    const isSel = () => i() === p.index
                    const isNew = () => item.name === "__new__"
                    return (
                      <box
                        flexDirection="row"
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={isSel() ? C_SEL_BG : undefined}
                      >
                        <Show
                          when={!isNew()}
                          fallback={
                            <text fg={C_ACCENT} attributes={TextAttributes.BOLD}>
                              + New agent…
                            </text>
                          }
                        >
                          <text
                            fg={props.agentColor(item.name)}
                            attributes={TextAttributes.BOLD}
                          >
                            {item.current ? "● " : "○ "}
                            {item.name.padEnd(14)}
                          </text>
                          <text fg={C_DIM} wrapMode="none">
                            {item.description ?? ""}
                          </text>
                        </Show>
                      </box>
                    )
                  }}
                </For>
                <box paddingLeft={1} paddingRight={1}>
                  <text fg={C_DIM}>
                    ↑↓ navigate · enter select · d delete · esc dismiss
                  </text>
                </box>
              </>
            )
          })()}
        </Show>

        <Show when={props.phase().type === "confirm"}>
          {(() => {
            const p = props.phase() as Extract<AgentPalettePhase, { type: "confirm" }>
            return (
              <>
                <box flexDirection="row" paddingLeft={1} paddingRight={1}>
                  <text fg={C_TEXT}>Delete agent </text>
                  <text fg={props.agentColor(p.name)} attributes={TextAttributes.BOLD}>
                    {p.name}
                  </text>
                  <text fg={C_TEXT}>?</text>
                </box>
                <box paddingLeft={1} paddingRight={1}>
                  <text fg={C_DIM}>y confirm · n / esc cancel</text>
                </box>
              </>
            )
          })()}
        </Show>

        <Show when={props.phase().type === "create"}>
          {(() => {
            const p = props.phase() as Extract<AgentPalettePhase, { type: "create" }>
            const rowFor = (label: string, value: string | undefined, active: boolean) => (
              <box flexDirection="row" paddingLeft={1} paddingRight={1}>
                <text fg={active ? C_ACCENT : C_DIM} attributes={active ? TextAttributes.BOLD : undefined}>
                  {(active ? "▸ " : "  ") + label.padEnd(14)}
                </text>
                <text fg={value ? C_TEXT : C_DIM}>{value ?? "…"}</text>
              </box>
            )
            return (
              <>
                {rowFor("Name", p.name, p.step === "name")}
                {rowFor("Description", p.description, p.step === "description")}
                {rowFor(
                  "Mode",
                  p.step === "mode" ? "primary | subagent | all" : undefined,
                  p.step === "mode",
                )}
                <box paddingLeft={1} paddingRight={1}>
                  <text fg={C_DIM}>
                    Type below then press Enter · esc to cancel
                  </text>
                </box>
              </>
            )
          })()}
        </Show>
      </box>
    </Show>
  )
}
