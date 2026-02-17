import { promises as fs } from "fs";
import path from "path";

type LogEntry = Record<string, unknown>;

type ParsedEvent = {
  ts: Date;
  sourceFile: string;
  script: string;
  success: boolean;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  message: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value: unknown): Date | null {
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function inferScriptName(fileName: string, entry: LogEntry): string {
  const explicit = entry.script ?? entry.source ?? entry.check;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();

  const base = fileName.replace(/\.jsonl$/i, "");
  if (base === "verification") return "verify_env";
  if (base === "extraction_errors") return "extract_insights";
  if (base === "delivery_errors") return "deliver_channel";
  return base;
}

function inferSuccess(fileName: string, entry: LogEntry): boolean {
  if (typeof entry.success === "boolean") return entry.success;
  if ("error" in entry && entry.error) return false;
  if ("errors" in entry && entry.errors) return false;
  return !fileName.includes("error");
}

function parseUsage(entry: LogEntry): { inputTokens: number; outputTokens: number } {
  const usage = (entry.usage ?? {}) as Record<string, unknown>;
  const inputTokens =
    asNumber(entry.input_tokens) ||
    asNumber(entry.prompt_tokens) ||
    asNumber(usage.input_tokens) ||
    asNumber(usage.prompt_tokens);
  const outputTokens =
    asNumber(entry.output_tokens) ||
    asNumber(entry.completion_tokens) ||
    asNumber(usage.output_tokens) ||
    asNumber(usage.completion_tokens);

  return { inputTokens, outputTokens };
}

function estimateCost(model: string | null, inputTokens: number, outputTokens: number): number {
  if (!model) return 0;
  const m = model.toLowerCase();
  let inputRate = 0;
  let outputRate = 0;

  if (m.includes("sonnet")) {
    inputRate = 3.0;
    outputRate = 15.0;
  } else if (m.includes("haiku")) {
    inputRate = 0.25;
    outputRate = 1.25;
  }

  return (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 5);
}

async function readJsonlEvents(logsDir: string): Promise<ParsedEvent[]> {
  const entries = await fs.readdir(logsDir, { withFileTypes: true });
  const jsonlFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl")).map((e) => e.name);
  const out: ParsedEvent[] = [];

  for (const fileName of jsonlFiles) {
    const fullPath = path.join(logsDir, fileName);
    const content = await fs.readFile(fullPath, "utf8");
    const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      let parsed: LogEntry;
      try {
        parsed = JSON.parse(line) as LogEntry;
      } catch {
        continue;
      }

      const ts =
        toDate(parsed.ts) ||
        toDate(parsed.timestamp) ||
        toDate(parsed.time) ||
        new Date();

      const { inputTokens, outputTokens } = parseUsage(parsed);
      const script = inferScriptName(fileName, parsed);
      const success = inferSuccess(fileName, parsed);
      const modelValue = parsed.model ?? parsed.model_used ?? null;
      const model = typeof modelValue === "string" ? modelValue : null;
      const messageValue = parsed.message ?? parsed.check ?? parsed.event ?? script;
      const message = typeof messageValue === "string" ? messageValue : script;

      out.push({
        ts,
        sourceFile: fileName,
        script,
        success,
        model,
        inputTokens,
        outputTokens,
        message
      });
    }
  }

  return out;
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(__dirname, "..");
  const logsDir = path.join(projectRoot, "logs");

  await fs.mkdir(logsDir, { recursive: true });
  const events = await readJsonlEvents(logsDir);
  const now = Date.now();
  const recent = events.filter((e) => now - e.ts.getTime() <= DAY_MS);

  const runs = recent.length;
  const successCount = recent.filter((e) => e.success).length;
  const failureCount = runs - successCount;
  const successRate = runs === 0 ? 1 : successCount / runs;

  const totalInputTokens = recent.reduce((sum, e) => sum + e.inputTokens, 0);
  const totalOutputTokens = recent.reduce((sum, e) => sum + e.outputTokens, 0);
  const totalCost = recent.reduce((sum, e) => sum + estimateCost(e.model, e.inputTokens, e.outputTokens), 0);

  const perScript = new Map<string, { success: number; failure: number }>();
  for (const event of recent) {
    const bucket = perScript.get(event.script) ?? { success: 0, failure: 0 };
    if (event.success) bucket.success += 1;
    else bucket.failure += 1;
    perScript.set(event.script, bucket);
  }

  const latest = [...recent]
    .sort((a, b) => b.ts.getTime() - a.ts.getTime())
    .slice(0, 5)
    .map((e) => `[${formatTime(e.ts)}] ${e.script} (${e.sourceFile}) - ${e.success ? "✅" : "❌"}`);

  process.stdout.write("\x1Bc");
  console.log("🤖 OPENCLAW AGENT STATUS [Last 24 Hours]");
  console.log("----------------------------------------");
  console.log(`Runs:       ${runs}`);
  console.log(`Success:    ${formatPercent(successRate)}`);
  console.log(`Cost:       $${totalCost.toFixed(3)}`);
  console.log(`Errors:     ${failureCount}`);
  console.log(`Tokens In:  ${totalInputTokens}`);
  console.log(`Tokens Out: ${totalOutputTokens}`);
  console.log("");
  console.log("SUCCESS/FAILURE BY SCRIPT:");
  if (perScript.size === 0) {
    console.log("- (no recent script activity in logs)");
  } else {
    for (const [script, counts] of [...perScript.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const total = counts.success + counts.failure;
      const rate = total === 0 ? 1 : counts.success / total;
      console.log(`- ${script.padEnd(20)} ${String(total).padStart(3)} runs | ${formatPercent(rate)} success`);
    }
  }

  console.log("");
  console.log("LATEST ACTIVITY:");
  if (latest.length === 0) {
    console.log("- (no recent activity)");
  } else {
    for (const line of latest) console.log(line);
  }

  if (totalCost > 5.0) {
    console.log("");
    console.log("\x1b[31m⚠️ HIGH COST DETECTED\x1b[0m");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Status report failed: ${message}`);
  process.exit(1);
});
