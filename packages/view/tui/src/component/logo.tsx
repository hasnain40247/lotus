import { TextAttributes } from "@opentui/core"
import { batch, createSignal, For, Index, onCleanup, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { nekoCells, nekoGif, nekoLabel, nekoWave, rgbHex } from "../logo"

export function Logo() {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" alignItems="center">
      <For each={nekoCells}>
        {(row) => (
          <text selectable={false}>
            <For each={row}>
              {(cell) => (
                <span style={{ fg: rgbHex(cell.fg), bg: rgbHex(cell.bg) }}>{cell.ch}</span>
              )}
            </For>
          </text>
        )}
      </For>
      <box height={1} />
      <For each={nekoLabel}>
        {(line) => (
          <text attributes={TextAttributes.BOLD} fg={theme.primary} selectable={false}>
            {line}
          </text>
        )}
      </For>
      <box height={1} />
      <text fg={theme.textMuted} selectable={false}>
        AI coding assistant
      </text>
    </box>
  )
}

// Plays the wave animation 4 times, then loops the gif forever.
const WAVE_LOOPS = 4

export function AnimatedCat() {
  const [phase, setPhase] = createSignal<"wave" | "gif">("wave")
  const [frameIdx, setFrameIdx] = createSignal(0)
  const [waveLoopCount, setWaveLoopCount] = createSignal(0)

  onMount(() => {
    const id = setInterval(() => {
      batch(() => {
        const p = phase()
        const next = frameIdx() + 1
        if (p === "wave") {
          if (next >= nekoWave.frames.length) {
            const loops = waveLoopCount() + 1
            if (loops >= WAVE_LOOPS) {
              setPhase("gif")
              setFrameIdx(0)
            } else {
              setWaveLoopCount(loops)
              setFrameIdx(0)
            }
          } else {
            setFrameIdx(next)
          }
        } else {
          setFrameIdx(next >= nekoGif.frames.length ? 0 : next)
        }
      })
    }, nekoWave.delayMs)
    onCleanup(() => clearInterval(id))
  })

  const frame = () => {
    const anim = phase() === "wave" ? nekoWave : nekoGif
    return anim.frames[frameIdx()] ?? anim.frames[0]!
  }

  return (
    <box flexDirection="column" alignItems="center" flexShrink={0}>
      <Index each={frame()}>
        {(row) => (
          <text selectable={false}>
            <For each={row()}>
              {(cell) => (
                <span style={{ fg: rgbHex(cell.fg), bg: rgbHex(cell.bg) }}>{cell.ch}</span>
              )}
            </For>
          </text>
        )}
      </Index>
    </box>
  )
}

export function LogoBanner() {
  const { theme } = useTheme()
  return (
    <box flexShrink={0} paddingTop={1} paddingBottom={1} alignItems="center">
      <text attributes={TextAttributes.BOLD} selectable={false}>
        <span style={{ fg: theme.accent }}>❀</span>
        <span style={{ fg: theme.primary }}> NEKO</span>
      </text>
    </box>
  )
}
