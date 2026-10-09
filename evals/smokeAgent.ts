import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentTool } from "@mariozechner/pi-agent-core/dist/types";
import { getEnvApiKey, type AssistantMessage, type Model } from "@mariozechner/pi-ai";
import type { PiAiRuntime, PiAiToolset } from "@vitest-evals/harness-pi-ai";

// The provider key to read from the local pi agent config. The default is the
// local llama-server (key "llama-cpp", 127.0.0.1:8080). Override with
// EVAL_PI_PROVIDER to point the smoke agent at a different registered model.
const PROVIDER_KEY = process.env.EVAL_PI_PROVIDER ?? "llama-cpp";
const PI_MODELS_JSON = join(homedir(), ".pi", "agent", "models.json");

const SYSTEM_PROMPT =
  "You are a minimal smoke-test agent. Reply in one short sentence.";

type PiModelsConfig = {
  providers: Record<
    string,
    {
      baseUrl: string;
      apiKey?: string;
      models: { id: string; name?: string }[];
    }
  >;
};

/**
 * Build an OpenAI-compatible pi-ai Model from the local pi agent config
 * (~/.pi/agent/models.json). pi-ai resolves the API key from Model.provider
 * via its env table, so the provider name is chosen from the config's apiKey:
 * "$HF_TOKEN" maps to "huggingface" (reads HF_TOKEN); any other key is a
 * local, no-auth server and maps to itself, which resolves to no key.
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
    provider: provider.apiKey === "$HF_TOKEN" ? "huggingface" : PROVIDER_KEY,
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

export type SmokeAgentOptions = {
  /**
   * System prompt for the agent. Defaults to a minimal smoke prompt. Pass the
   * text an agent should route on (e.g. an `<available_skills>` block) to test
   * routing behaviour instead of the pipeline round-trip.
   */
  systemPrompt?: string;
  /**
   * Tools the model can call, set on `AgentState.tools`. Pass a `read` tool
   * (see skills.ts) to let the model fetch a skill body on demand, as pi does.
   */
  tools?: AgentTool<any>[];
};

export class SmokeAgent {
  readonly toolset = EMPTY_TOOLSET;
  private readonly agent: Agent;
  private readonly model: Model<"openai-completions">;

  constructor(options: SmokeAgentOptions = {}) {
    this.model = buildModel();
    this.agent = new Agent({
      initialState: {
        systemPrompt: options.systemPrompt ?? SYSTEM_PROMPT,
        model: this.model,
        thinkingLevel: "off",
        tools: options.tools ?? [],
      },
      toolExecution: "sequential",
      // pi-ai aborts a stream when a provider resolves to no API key. A local,
      // no-auth server (e.g. llama.cpp) still needs a non-empty key to pass that
      // check, and the server ignores the value. Use the provider's real env key
      // when one is set (e.g. HF_TOKEN); otherwise fall back to a placeholder.
      getApiKey: (provider) => getEnvApiKey(provider) ?? "none",
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
      // An assistant message with no text usually means the model call errored
      // before producing content. Surface the provider's stop reason and error
      // so the failure is diagnosable instead of generic.
      const detail =
        assistant.errorMessage !== undefined
          ? ` (stopReason=${assistant.stopReason}: ${assistant.errorMessage})`
          : ` (stopReason=${assistant.stopReason})`;
      throw new Error(
        `Smoke agent returned an empty final response${detail}.`,
      );
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
export function createSmokeAgent(options: SmokeAgentOptions = {}) {
  return new SmokeAgent(options);
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
