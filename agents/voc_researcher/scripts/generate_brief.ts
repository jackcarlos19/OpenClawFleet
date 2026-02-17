import dotenv from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { CreativeBriefSchema, type CreativeBrief } from "../src/schemas/creative_brief.schema";
import { callOpenRouter } from "../src/utils/llm_client";

dotenv.config({ quiet: true });

type OpenClawConfig = {
  models?: {
    default?: string;
    extraction?: string;
    generation?: string;
  };
};

type Args = {
  inputPath: string;
};

const SummarySchema = z
  .object({
    core_pain_points: z.array(z.string()).optional(),
    metrics: z
      .object({
        top_pain_points: z.array(z.object({ phrase: z.string() })).optional()
      })
      .optional()
  })
  .passthrough();

function toOpenRouterApiModel(modelId: string): string {
  let normalized = modelId.trim();
  if (normalized.startsWith("openrouter/")) {
    normalized = normalized.slice("openrouter/".length);
  }
  normalized = normalized.replace("claude-3-5-sonnet", "claude-3.5-sonnet");
  return normalized;
}

function parseArgs(argv: string[]): Args {
  const inputPath = argv.find((arg) => !arg.startsWith("--")) ?? "";
  return { inputPath };
}

function extractDateFromFilename(filePath: string): string | null {
  const name = path.basename(filePath);
  const match = name.match(/_(\d{8})\.json$/);
  return match?.[1] ?? null;
}

function toDateStamp(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

async function findLatestSummaryFile(projectRoot: string): Promise<string> {
  const insightsDir = path.join(projectRoot, "insights");
  const entries = await fs.readdir(insightsDir, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isFile() && /^summary_\d{8}\.json$/.test(e.name))
    .map((e) => e.name)
    .sort();
  if (candidates.length === 0) {
    throw new Error("No summary file found in insights/ (expected summary_YYYYMMDD.json).");
  }
  return path.join(insightsDir, candidates[candidates.length - 1]);
}

function toMarkdownReport(brief: CreativeBrief, dateStamp: string): string {
  const lines: string[] = [];
  lines.push(`# Creative Brief (${dateStamp})`);
  lines.push("");
  lines.push(`## Target Audience`);
  lines.push(`${brief.target_audience}`);
  lines.push("");

  lines.push("## Core Pain Points");
  for (const point of brief.core_pain_points) {
    lines.push(`- ${point}`);
  }
  lines.push("");

  lines.push("## Angle Hypotheses");
  brief.angle_hypotheses.forEach((angle, index) => {
    lines.push(`### Angle ${index + 1}`);
    lines.push(`- Problem: ${angle.problem}`);
    lines.push(`- Solution: ${angle.solution}`);
    lines.push("");
  });

  lines.push("## Hooks");
  brief.hooks.forEach((hook) => lines.push(`- ${hook}`));
  lines.push("");

  lines.push("## 15s Scripts");
  brief.scripts_15s.forEach((script, index) => {
    lines.push(`### Script 15s #${index + 1}`);
    lines.push(`- Visual Cue: ${script.visual_cue}`);
    lines.push(`- Audio Script: ${script.audio_script}`);
    lines.push("");
  });

  lines.push("## 30s Scripts");
  brief.scripts_30s.forEach((script, index) => {
    lines.push(`### Script 30s #${index + 1}`);
    lines.push(`- Visual Cue: ${script.visual_cue}`);
    lines.push(`- Audio Script: ${script.audio_script}`);
    lines.push("");
  });

  lines.push("## UGC Prompts");
  brief.ugc_prompts.forEach((prompt) => lines.push(`- ${prompt}`));
  lines.push("");

  lines.push("## Compliance Notes");
  brief.compliance_notes.forEach((note) => lines.push(`- ${note}`));
  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(__dirname, "..");
  const { inputPath } = parseArgs(process.argv.slice(2));

  const summaryPath =
    inputPath.length > 0
      ? path.isAbsolute(inputPath)
        ? inputPath
        : path.join(projectRoot, inputPath)
      : await findLatestSummaryFile(projectRoot);

  const dateStamp = extractDateFromFilename(summaryPath) ?? toDateStamp();

  const configPath = path.join(projectRoot, "openclaw.json");
  const configRaw = await fs.readFile(configPath, "utf8");
  const config: OpenClawConfig = JSON.parse(configRaw);
  const configuredModel =
    config.models?.generation ?? config.models?.default ?? "openrouter/anthropic/claude-3.5-sonnet";
  const generationModel = toOpenRouterApiModel(configuredModel);

  const promptPath = path.join(projectRoot, "prompts", "generate_brief.md");
  const promptTemplate = await fs.readFile(promptPath, "utf8");
  const memoryPath = path.join(projectRoot, "memory", "MEMORY.md");
  const memoryContent = await fs.readFile(memoryPath, "utf8");
  const systemPrompt = promptTemplate.replace("{{MEMORY}}", memoryContent.trim());
  const summaryJson = await fs.readFile(summaryPath, "utf8");
  const summary = SummarySchema.parse(JSON.parse(summaryJson));

  const directPainPoints = (summary.core_pain_points ?? []).map((p) => p.trim()).filter(Boolean);
  const metricPainPoints = (summary.metrics?.top_pain_points ?? [])
    .map((item) => item.phrase.trim())
    .filter(Boolean);
  const effectivePainPoints = directPainPoints.length > 0 ? directPainPoints : metricPainPoints;

  await fs.mkdir(path.join(projectRoot, "briefs"), { recursive: true });
  if (effectivePainPoints.length === 0) {
    console.warn("Insufficient data for creative generation.");
    const skippedPath = path.join(projectRoot, "briefs", `skipped_${dateStamp}.json`);
    const skippedPayload = {
      status: "skipped",
      reason: "Insufficient data for creative generation.",
      input_summary: summaryPath,
      generated_at: new Date().toISOString()
    };
    await fs.writeFile(skippedPath, `${JSON.stringify(skippedPayload, null, 2)}\n`, "utf8");
    console.log(`- Skip status output: ${skippedPath}`);
    return;
  }

  const brief = (await callOpenRouter(
    generationModel,
    [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Generate a creative brief from this summary JSON:\n\n${summaryJson}`
      }
    ],
    CreativeBriefSchema
  )) as CreativeBrief;

  const jsonOutput = path.join(projectRoot, "briefs", `creative_brief_${dateStamp}.json`);
  const mdOutput = path.join(projectRoot, "briefs", `creative_brief_${dateStamp}.md`);

  await fs.writeFile(jsonOutput, `${JSON.stringify(brief, null, 2)}\n`, "utf8");
  await fs.writeFile(mdOutput, toMarkdownReport(brief, dateStamp), "utf8");

  const historyDir = path.join(projectRoot, "history");
  const sessionLogPath = path.join(historyDir, "session_log.md");
  await fs.mkdir(historyDir, { recursive: true });
  const historyLine = `[${new Date().toISOString().slice(0, 10)}] Generated Brief for ${brief.target_audience} - ${jsonOutput}`;
  await fs.appendFile(sessionLogPath, `${historyLine}\n`, "utf8");

  console.log("Creative brief generation complete.");
  console.log(`- Input summary: ${summaryPath}`);
  console.log(`- Model: ${generationModel}`);
  console.log(`- Memory file: ${memoryPath}`);
  console.log(`- JSON output: ${jsonOutput}`);
  console.log(`- Markdown output: ${mdOutput}`);
  console.log(`- Session log: ${sessionLogPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Generate brief failed: ${message}`);
  process.exit(1);
});
