import { For, Show, type Accessor } from "solid-js"
import { RGBA, TextAttributes } from "@opentui/core"
import {
  C_OVERLAY_BG as C_BG,
  C_OVERLAY_BORDER as C_BORDER,
  C_OVERLAY_TEXT as C_TEXT,
  C_OVERLAY_DIM as C_DIM,
  C_OVERLAY_SELECT as C_SEL_BG,
  C_OVERLAY_ACCENT as C_ACCENT,
} from "../palette"

// Semantic status colors — kept theme-agnostic; they pop on both bgs.
const C_OK   = RGBA.fromHex("#2E7D6E")
const C_WARN = RGBA.fromHex("#C05F3F")
const C_ERR  = RGBA.fromHex("#B02828")

export type McpPaletteItem = {
  name: string
  status: string
  error?: string
  command?: string
  toolCount?: number
}

export type McpPalettePhase =
  | { type: "select"; items: McpPaletteItem[]; index: number }
  | {
      type: "create"
      step: "name" | "command" | "env"
      name?: string
      command?: string
    }
  | { type: "confirm"; name: string; returnIndex: number; items: McpPaletteItem[] }

function statusColor(status: string) {
  if (status === "connected") return C_OK
  if (status === "error" || status === "failed") return C_ERR
  if (status === "connecting" || status === "starting") return C_WARN
  return C_DIM
}

function statusGlyph(status: string) {
  if (status === "connected") return "●"
  if (status === "error" || status === "failed") return "✗"
  if (status === "connecting" || status === "starting") return "…"
  return "○"
}

export function McpPalette(props: {
  visible: Accessor<boolean>
  phase: Accessor<McpPalettePhase>
}) {
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
            {props.phase().type === "select"
              ? "MCP servers"
              : props.phase().type === "create"
                ? "Add MCP server (local)"
                : "Confirm delete"}
          </text>
        </box>

        <Show when={props.phase().type === "select"}>
          {(() => {
            const p = props.phase() as Extract<McpPalettePhase, { type: "select" }>
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
                              + New MCP server…
                            </text>
                          }
                        >
                          <text fg={statusColor(item.status)} flexShrink={0}>
                            {statusGlyph(item.status) + " "}
                          </text>
                          <text fg={C_TEXT} attributes={TextAttributes.BOLD} flexShrink={0}>
                            {item.name.padEnd(14)}
                          </text>
                          <text fg={C_DIM} wrapMode="none">
                            {(item.error ? "error: " + item.error : item.command ?? "") +
                              (item.toolCount ? `   ${item.toolCount} tool${item.toolCount === 1 ? "" : "s"}` : "")}
                          </text>
                        </Show>
                      </box>
                    )
                  }}
                </For>
                <box paddingLeft={1} paddingRight={1}>
                  <text fg={C_DIM}>
                    ↑↓ navigate · enter reconnect · d delete · esc dismiss
                  </text>
                </box>
              </>
            )
          })()}
        </Show>

        <Show when={props.phase().type === "confirm"}>
          {(() => {
            const p = props.phase() as Extract<McpPalettePhase, { type: "confirm" }>
            return (
              <>
                <box flexDirection="row" paddingLeft={1} paddingRight={1}>
                  <text fg={C_TEXT}>Delete MCP </text>
                  <text fg={C_ACCENT} attributes={TextAttributes.BOLD}>
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
            const p = props.phase() as Extract<McpPalettePhase, { type: "create" }>
            const row = (label: string, value: string | undefined, active: boolean, hint?: string) => (
              <box flexDirection="row" paddingLeft={1} paddingRight={1}>
                <text
                  fg={active ? C_ACCENT : C_DIM}
                  attributes={active ? TextAttributes.BOLD : undefined}
                >
                  {(active ? "▸ " : "  ") + label.padEnd(12)}
                </text>
                <text fg={value ? C_TEXT : C_DIM}>{value ?? (active && hint ? hint : "…")}</text>
              </box>
            )
            return (
              <>
                {row("Name", p.name, p.step === "name", "e.g. github")}
                {row(
                  "Command",
                  p.command,
                  p.step === "command",
                  "e.g. npx -y @modelcontextprotocol/server-github",
                )}
                {row("Env", undefined, p.step === "env", "KEY=val KEY2=val2 (blank to skip)")}
                <box paddingLeft={1} paddingRight={1}>
                  <text fg={C_DIM}>Type below then press Enter · esc to cancel</text>
                </box>
              </>
            )
          })()}
        </Show>
      </box>
    </Show>
  )
}
