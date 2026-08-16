import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerNekoSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
