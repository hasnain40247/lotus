import { ProviderID, type ModelID } from "../schema"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat"
import type { RouteDefaultsInput } from "../route/client"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"

export const id = ProviderID.make("deepseek")

export const BASE_URL = "https://api.deepseek.com/v1"

export const routes = [OpenAICompatibleChat.route]

export type Config = RouteDefaultsInput & ProviderAuthOption<"optional"> & { readonly baseURL?: string }

export const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL, ...rest } = input
  const route = OpenAICompatibleChat.route.with({
    ...rest,
    provider: "deepseek",
    endpoint: { baseURL: baseURL ?? BASE_URL },
    auth: AuthOptions.bearer(input, ["DEEPSEEK_API_KEY"]),
  })
  return {
    id,
    model: (modelID: string | ModelID) => route.model({ id: modelID, provider: id }),
    configure,
  }
}

export const provider = configure()
export const model = provider.model
