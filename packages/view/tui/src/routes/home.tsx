import { Prompt, type PromptRef } from "../component/prompt"
import { createEffect, createSignal, onMount } from "solid-js"
import { Logo } from "../component/logo"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useRouteData } from "../context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { useEditorContext } from "../context/editor"
import { HomeSessionDestinationProvider } from "./home/session-destination"
import { useTheme } from "../context/theme"

let once = false
const placeholder = {
  normal: ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"],
  shell: ["ls -la", "git status", "pwd"],
}

export function Home() {
  const sync = useSync()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  const editor = useEditorContext()
  const { theme } = useTheme()
  let sent = false

  onMount(() => {
    editor.clearSelection()
  })

  const bind = (r: PromptRef | undefined) => {
    setRef(r)
    promptRef.set(r)
    if (once || !r) return
    if (route.prompt) {
      r.set(route.prompt)
      once = true
      return
    }
    if (!args.prompt) return
    r.set({ input: args.prompt, parts: [] })
    once = true
  }

  // Wait for sync and model store to be ready before auto-submitting --prompt
  createEffect(() => {
    const r = ref()
    if (sent) return
    if (!r) return
    if (!sync.ready || !local.model.ready) return
    if (!args.prompt) return
    if (r.current.input !== args.prompt) return
    sent = true
    r.submit()
  })

  return (
    <HomeSessionDestinationProvider>
      <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
        {/* Logo pinned to top */}
        <box flexShrink={0} paddingTop={7} paddingBottom={1} alignItems="center">
          <Logo />
        </box>

        {/* Middle: spacer pushes prompt to bottom */}
        <box flexGrow={1} minHeight={0} />

        {/* Prompt pinned at bottom */}
        <box width="100%" zIndex={1000} paddingTop={1} paddingBottom={0} marginBottom={0} flexShrink={0}>
          <Prompt ref={bind} placeholders={placeholder} />
        </box>

        <Toast />
      </box>
    </HomeSessionDestinationProvider>
  )
}
