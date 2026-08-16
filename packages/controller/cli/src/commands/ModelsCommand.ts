/**
 * ModelsCommand — list available models.
 *
 * Options:
 *   [provider]  filter by provider ID
 *   --verbose   show cost + context window metadata
 */

import type { CommandModule, Argv } from "yargs"
import { EOL } from "node:os"
import { formatModelList, color, type ModelInfo } from "@gco/view-cli"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModelsArgs = {
  provider?: string
  verbose?: boolean
}

// ---------------------------------------------------------------------------
// Static model registry
// The 4 supported providers with their known model IDs
// ---------------------------------------------------------------------------

const KNOWN_MODELS: ModelInfo[] = [
  // Anthropic
  {
    id: "claude-opus-4-5",
    providerID: "anthropic",
    name: "Claude Opus 4.5",
    status: "active",
    enabled: true,
    contextWindow: 200000,
    costInputPer1k: 0.015,
    costOutputPer1k: 0.075,
  },
  {
    id: "claude-sonnet-4-5",
    providerID: "anthropic",
    name: "Claude Sonnet 4.5",
    status: "active",
    enabled: true,
    contextWindow: 200000,
    costInputPer1k: 0.003,
    costOutputPer1k: 0.015,
  },
  {
    id: "claude-haiku-3-5",
    providerID: "anthropic",
    name: "Claude Haiku 3.5",
    status: "active",
    enabled: true,
    contextWindow: 200000,
    costInputPer1k: 0.0008,
    costOutputPer1k: 0.004,
  },
  // Vertex AI
  {
    id: "gemini-2.5-pro",
    providerID: "vertex-ai",
    name: "Gemini 2.5 Pro",
    status: "active",
    enabled: true,
    contextWindow: 1048576,
    costInputPer1k: 0.00125,
    costOutputPer1k: 0.01,
  },
  {
    id: "gemini-2.5-flash",
    providerID: "vertex-ai",
    name: "Gemini 2.5 Flash",
    status: "active",
    enabled: true,
    contextWindow: 1048576,
    costInputPer1k: 0.000075,
    costOutputPer1k: 0.0003,
  },
  {
    id: "gemini-2.0-flash",
    providerID: "vertex-ai",
    name: "Gemini 2.0 Flash",
    status: "active",
    enabled: true,
    contextWindow: 1048576,
    costInputPer1k: 0.0001,
    costOutputPer1k: 0.0004,
  },
  // DeepSeek
  {
    id: "deepseek-v4-flash",
    providerID: "deepseek",
    name: "DeepSeek V4 Flash",
    status: "active",
    enabled: true,
    contextWindow: 64000,
    costInputPer1k: 0,
    costOutputPer1k: 0,
  },
  {
    id: "deepseek-v4-pro",
    providerID: "deepseek",
    name: "DeepSeek V4 Pro",
    status: "active",
    enabled: true,
    contextWindow: 64000,
    costInputPer1k: 0,
    costOutputPer1k: 0,
  },
  // Ollama (local, no cost)
  {
    id: "llama3.2",
    providerID: "ollama",
    name: "Llama 3.2",
    status: "active",
    enabled: true,
    contextWindow: 128000,
    costInputPer1k: 0,
    costOutputPer1k: 0,
  },
  {
    id: "qwen2.5-coder",
    providerID: "ollama",
    name: "Qwen 2.5 Coder",
    status: "active",
    enabled: true,
    contextWindow: 32000,
    costInputPer1k: 0,
    costOutputPer1k: 0,
  },
]

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function modelsHandler(args: ModelsArgs): Promise<void> {
  let models = KNOWN_MODELS

  if (args.provider) {
    models = models.filter((m) => m.providerID === args.provider)
    if (models.length === 0) {
      process.stderr.write(
        color.red("Error: ") + `Provider not found: ${args.provider}` + EOL,
      )
      process.exitCode = 1
      return
    }
  }

  process.stdout.write(formatModelList(models, args.verbose) + EOL)
}

// ---------------------------------------------------------------------------
// Command export
// ---------------------------------------------------------------------------

export const ModelsCommand: CommandModule<object, ModelsArgs> = {
  command: "models [provider]",
  describe: "list all available models",

  builder: (yargs: Argv) =>
    yargs
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
      })
      .option("verbose", {
        alias: ["v"],
        describe: "show verbose model output (cost and context window)",
        type: "boolean",
        default: false,
      }) as unknown as Argv<ModelsArgs>,

  handler: (args) => modelsHandler(args),
}
