import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Model } from "@mariozechner/pi-ai";
import type { PiAiRuntime, PiAiToolset } from "@vitest-evals/harness-pi-ai";

// The provider key to read from the local pi agent config. Override with
// EVAL_PI_PROVIDER to point the smoke agent at a different registered model.
const PROVIDER_KEY = process.env.EVAL_PI_PROVIDER ?? "hf-qwen3-8-27b";
const PI_MODELS_JSON = join(homedir(), ".pi", "agent", "models.json");

const SYSTEM_PROMPT =
  "You are a minimal smoke-test agent. Reply in one short sentence.";

type PiModelsConfig = {
  providers: Record<
    string,
    { baseUrl: string; models: { id: string; name?: string }[] }
  >;
};

/**
 * Build an OpenAI-compatible pi-ai Model from the local pi agent config
 * (~/.pi/agent/models.json). The auth token resolves from HF_TOKEN via the
 * "huggingface" provider mapping in pi-ai's env-api-keys table.
 */
function buildModel(): Model<"openai-completions"> {
  const config = JSON.parse(
    readFileSync(PI_MODELS_JSON, "utf8"),
  ) as PiModelsConfig;
  const provider = config.providers[PROVIDER_KEY];
  const model = provider?.models?.[0];
  if (!provider?.baseUrl || !model) {
    throw new Error(
      `Provider "${PROVIDER_KEY}" with a model was not found in ${PI_MODELS_JSON}. ` +
        `Set EVAL_PI_PROVIDER to a valid provider key in that file.`,
    );
  }
  return {
    id: model.id,
    name: model.name ?? model.id,
    api: "openai-completions",
    // pi-ai maps the "huggingface" provider to the HF_TOKEN env var.
    provider: "huggingface",
    baseUrl: provider.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 4096,
  };
}

const EMPTY_TOOLSET = {} satisfies PiAiToolset<string>;
type SmokeRuntime = PiAiRuntime<typeof EMPTY_TOOLSET, string>;

export class SmokeAgent {
  readonly toolset = EMPTY_TOOLSET;
  private readonly agent: Agent;
  private readonly model: Model<"openai-completions">;

  constructor() {
    this.model = buildModel();
    this.agent = new Agent({
      initialState: {
        systemPrompt: SYSTEM_PROMPT,
        model: this.model,
        thinkingLevel: "off",
        tools: [],
      },
      toolExecution: "sequential",
    });
  }

  async run(input: string, runtime: SmokeRuntime) {
    await this.agent.prompt(input);

    const assistant = getFinalAssistantMessage(this.agent.state.messages);
    if (!assistant) {
      throw new Error("Smoke agent did not produce a final assistant message.");
    }
    const text = getAssistantText(assistant);
    if (!text) {
      throw new Error("Smoke agent returned an empty final response.");
    }

    runtime.events.assistant(text, {
      provider: assistant.provider,
      model: assistant.model,
      totalTokens: assistant.usage.totalTokens,
    });

    // The harness reads token usage from the object run() returns
    // (result.usage ?? result.metrics), not from the assistant event.
    return {
      output: text,
      metrics: {
        totalTokens: assistant.usage.totalTokens,
        inputTokens: assistant.usage.input,
        outputTokens: assistant.usage.output,
        provider: assistant.provider,
        model: assistant.model,
      },
    };
  }
}

/** Creates a fresh smoke agent for one eval run. */
export function createSmokeAgent() {
  return new SmokeAgent();
}

function getFinalAssistantMessage(
  messages: unknown[],
): AssistantMessage | undefined {
  return [...messages].reverse().find(
    (m): m is AssistantMessage =>
      Boolean(
        m &&
          typeof m === "object" &&
          "role" in m &&
          (m as { role?: unknown }).role === "assistant" &&
          "content" in m,
      ),
  );
}

function getAssistantText(message: AssistantMessage) {
  return message.content
    .filter(
      (block): block is Extract<
        AssistantMessage["content"][number],
        { type: "text" }
      > => block.type === "text",
    )
    .map((block) => block.text)
    .join("")
    .trim();
}
