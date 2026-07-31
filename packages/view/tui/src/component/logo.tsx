import { TextAttributes } from "@opentui/core"
import { createSignal, For, onCleanup } from "solid-js"
import { useTheme } from "../context/theme"
import { lotusArt } from "../logo"

const EYE_LINE_INDEX = 7
// Line 7 structure: prefix(0-7) + leftEye(8-9) + gap+mouth(10-12) + gap(13) + rightEye(14-15) + suffix(16-23)
const eyeLineChars = Array.from(lotusArt[EYE_LINE_INDEX]!)
const EYE_PREFIX = eyeLineChars.slice(0, 8).join("")
const LEFT_EYE_OPEN = eyeLineChars.slice(8, 10).join("")    // ⠐⠇
const EYE_MIDDLE = eyeLineChars.slice(10, 14).join("")      // ⠀⠶⠶⠀
const RIGHT_EYE_OPEN = eyeLineChars.slice(14, 16).join("")  // ⠸⠂
const EYE_SUFFIX = eyeLineChars.slice(16).join("")

const LEFT_EYE_CLOSED = "⠒⠒"
const RIGHT_EYE_CLOSED = "⠒⠒"

export function Logo() {
  const { theme } = useTheme()
  const [eyesOpen, setEyesOpen] = createSignal(true)

  let blinkTimer: ReturnType<typeof setTimeout>

  const scheduleBlink = () => {
    blinkTimer = setTimeout(() => {
      setEyesOpen(false)
      blinkTimer = setTimeout(() => {
        setEyesOpen(true)
        scheduleBlink()
      }, 130)
    }, 2500 + Math.random() * 2000)
  }

  scheduleBlink()
  onCleanup(() => clearTimeout(blinkTimer))

  const eyeLine = () =>
    EYE_PREFIX +
    (eyesOpen() ? LEFT_EYE_OPEN : LEFT_EYE_CLOSED) +
    EYE_MIDDLE +
    (eyesOpen() ? RIGHT_EYE_OPEN : RIGHT_EYE_CLOSED) +
    EYE_SUFFIX

  return (
    <box flexDirection="column" alignItems="center">
      <For each={lotusArt}>
        {(line, index) => (
          <box flexDirection="row">
            <text fg={theme.primary} selectable={false}>
              {index() === EYE_LINE_INDEX ? eyeLine() : line}
            </text>
          </box>
        )}
      </For>
      <box height={1} />
      <text fg={theme.primary} attributes={TextAttributes.BOLD} selectable={false}>
        L O T U S
      </text>
    </box>
  )
}

export function LogoBanner() {
  const { theme } = useTheme()
  return (
    <box flexShrink={0} paddingTop={1} paddingBottom={1} alignItems="center">
      <text fg={theme.primary} attributes={TextAttributes.BOLD} selectable={false}>
        ❀  L O T U S
      </text>
    </box>
  )
}
