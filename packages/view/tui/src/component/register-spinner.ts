import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerLotusCodeSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
