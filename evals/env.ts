/**
 * Environment knobs for the eval suite, resolved once.
 *
 * `vitest.evals.config.ts` and `evals/skills.eval.ts` both need these values and
 * have to agree on them. They used to read `EVAL_SAMPLES` and `EVAL_TIMEOUT_MS`
 * separately, and the config derived `testTimeout` from a hard-coded 300s rather
 * than from `EVAL_TIMEOUT_MS` — so raising the prompt timeout past 300s made
 * vitest kill the test before the harness timer ever fired.
 *
 * A bad value throws instead of falling back. `Number("abc")` is `NaN`, and
 * `Math.max(1, NaN)` is `NaN`, so a typo used to run zero samples and report
 * every case as `0/NaN` — a silent green suite that tested nothing. A misspelled
 * `EVAL_AGENT` gets the same treatment: it names the thing under test, so
 * falling back to the default would report the wrong agent's scores.
 */

type NumberEnvOptions = {
  /** Value used when the variable is unset or empty. */
  fallback: number;
  /** Smallest accepted value. */
  min: number;
  /** Largest accepted value, when the knob has a natural ceiling. */
  max?: number;
  /** Rejects a fractional value when true. */
  integer?: boolean;
};

export function readNumberEnv(name: string, options: NumberEnvOptions): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return options.fallback;

  const value = Number(raw);
  const valid =
    Number.isFinite(value) &&
    value >= options.min &&
    (options.max === undefined || value <= options.max) &&
    (options.integer !== true || Number.isInteger(value));

  if (!valid) {
    const range =
      options.max === undefined
        ? `>= ${options.min}`
        : `between ${options.min} and ${options.max}`;
    throw new Error(
      `${name}=${JSON.stringify(raw)} is not a ${options.integer === true ? "whole " : ""}` +
        `number ${range}`,
    );
  }
  return value;
}

type StringEnvOptions<T extends string> = {
  fallback: T;
  /** Accepted values. A value outside the list throws. */
  choices: readonly T[];
};

export function readChoiceEnv<T extends string>(name: string, options: StringEnvOptions<T>): T {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return options.fallback;

  const value = raw.trim() as T;
  if (!options.choices.includes(value)) {
    throw new Error(`${name}=${JSON.stringify(raw)} is not one of: ${options.choices.join(", ")}`);
  }
  return value;
}

function readOptionalEnv(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw === undefined || raw === "" ? undefined : raw;
}

/** Reads a comma-separated list. Empty when unset, which every reader treats as "all". */
function readListEnv(name: string): string[] {
  return (readOptionalEnv(name) ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Agents the suite can run a prompt through. */
export const AGENT_NAMES = ["claude-code", "pi"] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

/** Where `expected_terms` are matched. See `scoreCanonicalAnswer`. */
export const TERM_SCOPES = ["answer", "transcript"] as const;

export type TermScope = (typeof TERM_SCOPES)[number];

/**
 * Base URL assumed when `EVAL_PROVIDER` names a local server and
 * `EVAL_BASE_URL` is unset.
 *
 * `llama-cpp` is pi's own convention for a local `llama-server`, so the default
 * matches the provider block pi ships in its docs.
 */
const LOCAL_PROVIDER_BASE_URLS: Record<string, string> = {
  "llama-cpp": "http://127.0.0.1:8080/v1",
  "lm-studio": "http://127.0.0.1:1234/v1",
  ollama: "http://127.0.0.1:11434/v1",
};

const DEFAULT_TIMEOUT_MS = 240_000;

function resolveSettings() {
  const agent = readChoiceEnv<AgentName>("EVAL_AGENT", {
    fallback: "claude-code",
    choices: AGENT_NAMES,
  });
  const provider = readOptionalEnv("EVAL_PROVIDER");
  const samples = readNumberEnv("EVAL_SAMPLES", { fallback: 1, min: 1, integer: true });
  const timeoutMs = readNumberEnv("EVAL_TIMEOUT_MS", {
    fallback: DEFAULT_TIMEOUT_MS,
    min: 1000,
    integer: true,
  });

  /**
   * A local server answers one prompt at a time, so the cloud default of 4
   * concurrent prompts just queues them all past the timeout.
   */
  const baseUrl = readOptionalEnv("EVAL_BASE_URL") ?? LOCAL_PROVIDER_BASE_URLS[provider ?? ""];
  const concurrency = readNumberEnv("EVAL_CONCURRENCY", {
    fallback: baseUrl === undefined ? 4 : 1,
    min: 1,
    integer: true,
  });

  return {
    agent,
    /** Model passed to the agent CLI. Each harness supplies its own default. */
    model: readOptionalEnv("EVAL_MODEL"),
    /** Provider passed to the agent CLI, when the agent takes one. */
    provider,
    /** Health-check URL for a local model server. Undefined for cloud runs. */
    baseUrl,
    /** Directory the agent runs in. Point it at a `common` checkout. */
    cwd: readOptionalEnv("EVAL_CWD"),
    /**
     * Skills to run, by name. Empty runs all of them.
     *
     * The cost lever for CI: a full run is 114 turns, and a PR that touches one
     * skill only needs that skill's 8 to 14 cases.
     */
    skills: readListEnv("EVAL_SKILLS"),
    samples,
    timeoutMs,
    concurrency,
    /**
     * Fraction of samples that must pass.
     *
     * Capped at 1, so `EVAL_PASS_RATE=50` — percent instead of the documented
     * fraction — throws rather than failing every case against `need 50`.
     */
    passRate: readNumberEnv("EVAL_PASS_RATE", { fallback: 0.5, min: 0, max: 1 }),
    termScope: readChoiceEnv<TermScope>("EVAL_TERM_SCOPE", {
      fallback: "answer",
      choices: TERM_SCOPES,
    }),
    /** Vitest cap per test: every sample, plus slack for judge and report work. */
    testTimeoutMs: timeoutMs * samples + 30_000,
    reportFile: readOptionalEnv("EVAL_REPORT_FILE") ?? `.vitest-evals/report-${agent}.json`,
  };
}

/** Resolved once at import, so every reader sees the same numbers. */
export const evalSettings = resolveSettings();
