import dotenv from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { callOpenRouter } from "../src/utils/llm_client";

type OpenClawConfig = {
  models?: {
    default?: string;
    extraction?: string;
    generation?: string;
  };
};

const TrendsItemSchema = z.object({
  ad: z.object({
    ad_text: z.string(),
    headline: z.string(),
    image_description: z.string()
  }),
  analysis: z.object({
    main_angle: z.string(),
    hook_type: z.string(),
    aggression_score: z.number(),
    target_demographic: z.string(),
    estimated_spend_tier: z.enum(["Low", "Medium", "High"])
  })
});

const NewTrendsSchema = z.object({
  generated_at: z.string(),
  source_analysis_file: z.string(),
  known_angles_before: z.array(z.string()),
  newly_detected_angles: z.array(z.string()),
  fresh_findings: z.array(TrendsItemSchema)
});

function toOpenRouterApiModel(modelId: string): string {
  let normalized = modelId.trim();
  if (normalized.startsWith("openrouter/")) {
    normalized = normalized.slice("openrouter/".length);
  }
  return normalized;
}

async function findLatestTrendsFile(insightsDir: string): Promise<string> {
  const entries = await fs.readdir(insightsDir, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isFile() && /^new_trends_\d{8}\.json$/.test(e.name))
    .map((e) => e.name)
    .sort();
  if (candidates.length === 0) {
    throw new Error("No trends file found (expected insights/new_trends_YYYYMMDD.json).");
  }
  return path.resolve(insightsDir, candidates[candidates.length - 1]);
}

function noChangesReport(trendsPath: string, generatedAt: string): string {
  return [
    "# Daily Competitor Brief",
    "",
    "## 🚨 Alert",
    "- No Changes Detected.",
    "",
    "## 🕵️ Analysis",
    "- No new competitor angles were detected in the latest run.",
    "- Existing angle set remains unchanged from memory.",
    "",
    "## ⚔️ Counter-Move",
    "- Continue current top-performing creative tests.",
    "- Re-run competitor scan on next cycle to detect emerging shifts early.",
    "",
    `Source: \`${trendsPath}\``,
    `Generated At: ${generatedAt}`
  ].join("\n");
}

async function main(): Promise<void> {
  const agentRoot = path.resolve(__dirname, "..");
  const repoRoot = path.resolve(agentRoot, "..", "..");
  dotenv.config({ path: path.resolve(repoRoot, ".env"), quiet: true });

  const insightsDir = path.resolve(agentRoot, "insights");
  const configPath = path.resolve(agentRoot, "openclaw.json");
  const promptPath = path.resolve(agentRoot, "prompts", "write_competitor_brief.md");
  const reportsDir = path.resolve(repoRoot, "reports");
  const reportPath = path.resolve(reportsDir, "daily_competitor.md");

  const trendsPath = await findLatestTrendsFile(insightsDir);
  const trendsRaw = await fs.readFile(trendsPath, "utf8");
  const trends = NewTrendsSchema.parse(JSON.parse(trendsRaw));

  await fs.mkdir(reportsDir, { recursive: true });

  if (trends.newly_detected_angles.length === 0 || trends.fresh_findings.length === 0) {
    const markdown = noChangesReport(trendsPath, new Date().toISOString());
    await fs.writeFile(reportPath, `${markdown}\n`, "utf8");
    console.log("Competitor report complete (no changes).");
    console.log(`- Input trends: ${trendsPath}`);
    console.log(`- Output: ${reportPath}`);
    return;
  }

  const configRaw = await fs.readFile(configPath, "utf8");
  const prompt = await fs.readFile(promptPath, "utf8");
  const config: OpenClawConfig = JSON.parse(configRaw);
  const reportModel = toOpenRouterApiModel(
    config.models?.default ?? config.models?.generation ?? "openrouter/anthropic/claude-3.5-sonnet"
  );

  const markdown = await callOpenRouter(
    reportModel,
    [
      { role: "system", content: prompt },
      {
        role: "user",
        content: `Generate today's competitor report from this JSON:\n\n${JSON.stringify(trends, null, 2)}`
      }
    ]
  );

  await fs.writeFile(reportPath, `${String(markdown).trim()}\n`, "utf8");

  console.log("Competitor report complete.");
  console.log(`- Input trends: ${trendsPath}`);
  console.log(`- Model: ${reportModel}`);
  console.log(`- Output: ${reportPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Competitor report failed: ${message}`);
  process.exit(1);
});
