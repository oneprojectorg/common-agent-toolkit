/**
 * Runs an agent CLI and feeds its stdout to a line parser.
 *
 * Both harnesses need the same four things: a hard wall-clock kill, vitest's
 * abort signal honoured, the partial last line flushed before resolving, and a
 * stderr tail kept for a non-zero exit. Getting that right once means a timed
 * out pi run keeps the trajectory it got through, exactly as a Claude Code run
 * does — and that trail is usually what tells you why the skill did not load.
 *
 * It never throws for a failed turn. A crash or a timeout comes back as a reason
 * string, so the caller reports a run with no answer and the judges score it 0.
 */
import { spawn, spawnSync } from "node:child_process";
import type { JsonValue } from "vitest-evals";

export type SpawnStreamOptions = {
  command: string;
  args: string[];
  cwd: string;
  /** Hard wall-clock cap. The child is SIGKILLed when it elapses. */
  timeoutMs: number;
  signal?: AbortSignal;
  /** Called with every complete stdout line, then with the partial tail. */
  onLine: (line: string) => void;
  setArtifact: (name: string, value: JsonValue) => void;
};

/** Resolves with the run's reason: `exit-0`, `exit-1`, `timeout`, `aborted`, ... */
export function spawnLineStream(options: SpawnStreamOptions): Promise<string> {
  return new Promise<string>((resolve) => {
    // A nested agent run inherits these and refuses to start.
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdoutTail = "";
    let stderrTail = "";
    let settled = false;

    const settle = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (stdoutTail) {
        options.onLine(stdoutTail);
        stdoutTail = "";
      }
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle("timeout");
    }, options.timeoutMs);

    const onAbort = () => {
      child.kill("SIGKILL");
      settle("aborted");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutTail += chunk;
      const lines = stdoutTail.split("\n");
      stdoutTail = lines.pop() ?? "";
      for (const line of lines) options.onLine(line);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-2000);
    });

    child.on("error", (error) => {
      options.setArtifact("spawnError", error.message);
      settle("spawn-error");
    });

    child.on("close", (code, signal) => {
      if (code !== 0) options.setArtifact("stderrTail", stderrTail);
      if (code === 0) return settle("exit-0");
      // A child killed by a signal reports a null code, which read as the
      // literal `exit-null` — no help when the OOM killer is the reason.
      settle(signal === null ? `exit-${code}` : `signal-${signal}`);
    });
  });
}

/** True when `command --version` resolves on PATH and exits 0. */
export function hasCli(command: string): boolean {
  const probe = spawnSync(command, ["--version"], { stdio: "ignore" });
  return probe.error === undefined && probe.status === 0;
}

/**
 * True when an OpenAI-compatible server answers at `<baseUrl>/models`.
 *
 * Synchronous on purpose: vitest's `skipIf` predicate is synchronous, and a
 * stopped `llama-server` has to skip the suite rather than time out 114 cases.
 */
export function hasModelServer(baseUrl: string): boolean {
  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  const probe = spawnSync(
    "curl",
    ["-sS", "-m", "5", "-o", "/dev/null", "-w", "%{http_code}", url],
    { encoding: "utf8" },
  );
  if (probe.error !== undefined || probe.status !== 0) return false;
  return /^[23]\d\d$/.test(probe.stdout.trim());
}
