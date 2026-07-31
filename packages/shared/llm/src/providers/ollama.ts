import { ProviderID, type ModelID } from "../schema"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat"
import type { RouteDefaultsInput } from "../route/client"
import { Auth } from "../route/auth"

export const id = ProviderID.make("ollama")

export const BASE_URL = "http://localhost:11434/v1"

export const routes = [OpenAICompatibleChat.route]

export type Config = RouteDefaultsInput & { readonly baseURL?: string }

export const configure = (input: Config = {}) => {
  const { baseURL, ...rest } = input
  const route = OpenAICompatibleChat.route.with({
    ...rest,
    provider: "ollama",
    endpoint: { baseURL: baseURL ?? BASE_URL },
    auth: Auth.none,
  })
  return {
    id,
    model: (modelID: string | ModelID) => route.model({ id: modelID, provider: id }),
    configure,
  }
}

export const provider = configure()
export const model = provider.model
