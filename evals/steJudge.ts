/**
 * LLM judge for the technical-writing (Simplified Technical English / STE) skill.
 *
 * The judge is an agent whose system prompt carries the STE rubric and a strict
 * JSON output contract (JUDGE_SYSTEM_PROMPT). Given a piece of text, it returns
 * a structured verdict: whether the text passes and the exact rule(s) it
 * violates, each with the offending quote. technical-writing.eval.ts proves the
 * judge discriminates by grading known-clean and deliberately-flawed samples.
 *
 * The rubric is derived from plugins/devtools/skills/technical-writing/SKILL.md.
 * It is inlined here rather than read through a tool so that judging is a single
 * model call with a small, reliable surface on a local model. Keep it in sync
 * with the skill if the skill's rules change.
 */

/** The rule ids the judge may report. The eval asserts on these exact ids. */
export const STE_RULE_IDS = [
  "sentence-too-long",
  "passive-voice",
  "complex-tense",
  "banned-phrase",
  "filler-word",
  "synonym-drift",
  "noun-stack",
  "intro-outro",
] as const;

/** One rule the sample is judged to break, with the offending text. */
export interface SteViolation {
  /** A rule id from STE_RULE_IDS (normalized: lower-case, hyphen-separated). */
  rule: string;
  /** The exact words from the sample that break the rule. */
  quote: string;
}

/** The judge's verdict for one sample. */
export interface SteVerdict {
  /** True only when no rule is violated (derived from `violations`). */
  pass: boolean;
  violations: SteViolation[];
  /** One short sentence summarizing the verdict (free-form, not asserted). */
  summary: string;
  /** The judge model's raw output, kept so failures are diagnosable. */
  raw: string;
}

/**
 * The judge's system prompt: role, the STE rubric (one definition per rule id),
 * and a strict JSON output contract. The model must emit only the JSON object —
 * no prose, no markdown, no code fences.
 */
export const JUDGE_SYSTEM_PROMPT = `You are a strict technical-writing reviewer.
You grade a piece of text against Simplified Technical English (STE) rules.
You do not rewrite the text. You only decide whether it passes and list the exact rules it breaks.

Report a violation using ONLY one of these rule ids:
- sentence-too-long: a sentence has more words than its limit. The limit is 20 words for an instruction or a procedure step, and 25 words for a description or an explanation.
- passive-voice: a clause uses the passive voice (the action is done to the subject, usually "is/are/was" + a past participle, example: "an error is returned"). An imperative step like "Run the app" is active and is fine.
- complex-tense: a verb uses a tense other than the simple present or simple past (a perfect, progressive, or conditional tense, example: "will be applied" or "has returned").
- banned-phrase: the text uses a banned phrase. Banned phrases: "It is important to note", "Note that", "Crucially", "Keep in mind", "It is not just X, it is also Y", "Sure, I can help with that", "Hope this helps".
- filler-word: the text uses a filler or hype word: powerful, seamless, robust, comprehensive, simply, just.
- synonym-drift: the text uses different words for the same meaning within one document (example: "field", "attribute", and "property" all meaning the same thing).
- noun-stack: the text puts more than three nouns in a row (example: "server request retry policy").
- intro-outro: the text opens or closes with filler, praise, or a build-up to the point instead of the point itself.

Decide like this:
- Set "pass" to true only when "violations" is an empty array.
- Add one object per distinct violation you can clearly see. Do not invent violations and do not repeat one.
- "quote" is the exact text from the sample that breaks the rule.
- If you are not sure a rule is broken, do not report it.
- If the text is clean, return an empty "violations" array.

Output only a JSON object. No prose, no markdown, no code fences. Use this exact shape:
{"pass":false,"violations":[{"rule":"banned-phrase","quote":"It is important to note"}],"summary":"One short sentence."}`;

/**
 * Build the user prompt that hands the judge a sample. The sample is wrapped in
 * triple quotes so its boundaries are unambiguous to the model.
 */
export function steUserPrompt(sample: string): string {
  return `Grade this text against the STE rubric.\n"""\n${sample}\n"""`;
}

/** A runner that sends a prompt to the judge and returns the assistant text. */
export type JudgeRunFn = (prompt: string) => Promise<{ output: string }>;

/**
 * Grade one sample with the judge. Retries on a malformed (unparseable) verdict
 * only — a wrong-but-valid verdict is kept, so a misgrading judge is exposed by
 * the eval rather than papered over by a re-roll.
 */
export async function judgeText(
  run: JudgeRunFn,
  sample: string,
  maxAttempts = 3,
): Promise<SteVerdict> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { output } = await run(steUserPrompt(sample));
    try {
      return parseVerdict(output);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`judge: failed after ${maxAttempts} attempts`);
}

/**
 * Parse and validate the judge's output into a SteVerdict. Throws a descriptive
 * error when the model did not return a usable JSON verdict, so a broken judge
 * fails loudly instead of silently passing.
 */
export function parseVerdict(raw: string): SteVerdict {
  const jsonText = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `judge: output is not valid JSON: ${(err as Error).message}\nraw=${raw}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`judge: output is not a JSON object\nraw=${raw}`);
  }

  const obj = parsed as Record<string, unknown>;
  const rawViolations = Array.isArray(obj.violations) ? obj.violations : [];
  const violations: SteViolation[] = [];
  for (const item of rawViolations) {
    if (typeof item !== "object" || item === null) continue;
    const v = item as Record<string, unknown>;
    const rule = normalizeRuleId(v.rule);
    if (!rule) continue;
    violations.push({ rule, quote: typeof v.quote === "string" ? v.quote : "" });
  }

  const summary = typeof obj.summary === "string" ? obj.summary : "";
  const pass = violations.length === 0;
  return { pass, violations, summary, raw };
}

/** Lower-case a rule id and turn spaces into hyphens ("Banned Phrase" -> "banned-phrase"). */
function normalizeRuleId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Pull the first balanced JSON object out of the model's output. Handles a
 * ```json fenced block and any leading or trailing prose the model may add.
 */
function extractJsonObject(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fence ? [fence[1]] : [];
  candidates.push(raw);
  for (const text of candidates) {
    const found = findBalancedBrace(text);
    if (found !== null) return found;
  }
  throw new Error(`judge: no JSON object found in output\nraw=${raw}`);
}

/** Return the first balanced {...} substring, or null if there is none. */
function findBalancedBrace(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
