import { execSync } from "child_process";
import dotenv from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import axios from "axios";
import { callOpenRouter } from "../agents/voc_researcher/src/utils/llm_client";

type OpenClawConfig = {
  models?: {
    default?: string;
    extraction?: string;
    generation?: string;
  };
};

function toOpenRouterApiModel(modelId: string): string {
  let normalized = modelId.trim();
  if (normalized.startsWith("openrouter/")) {
    normalized = normalized.slice("openrouter/".length);
  }
  normalized = normalized.replace("claude-3-5-sonnet", "claude-3.5-sonnet");
  return normalized;
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function findLatestFile(dirPath: string, pattern: RegExp): Promise<string | null> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const matches = entries
      .filter((entry) => entry.isFile() && pattern.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    if (matches.length === 0) return null;
    return path.resolve(dirPath, matches[matches.length - 1]);
  } catch {
    return null;
  }
}

function runFleetStep(command: string, cwd: string): void {
  execSync(command, { cwd, stdio: "inherit" });
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(__dirname, "..");
  dotenv.config({ path: path.resolve(projectRoot, ".env"), quiet: true });

  console.log("Running daily fleet steps...");
  runFleetStep("npm run spy:detect", projectRoot);
  runFleetStep("npm run spy:report", projectRoot);
  runFleetStep("npm run supply:check", projectRoot);

  const competitorPath = path.resolve(projectRoot, "reports", "daily_competitor.md");
  const inventoryPath = path.resolve(projectRoot, "reports", "daily_inventory.md");
  const vocPath = path.resolve(projectRoot, "reports", "daily_voc.md");
  const promptPath = path.resolve(projectRoot, "prompts", "executive_summary.md");
  const vocFallbackPath = await findLatestFile(
    path.resolve(projectRoot, "agents", "voc_researcher", "briefs"),
    /^creative_brief_\d{8}\.md$/
  );
  const configPath = path.resolve(projectRoot, "agents", "voc_researcher", "openclaw.json");

  const competitorReport = await readOptional(competitorPath);
  const inventoryReport = await readOptional(inventoryPath);
  const vocReport = (await readOptional(vocPath)) ?? (await readOptional(vocFallbackPath));
  const prompt = await fs.readFile(promptPath, "utf8");
  const configRaw = await fs.readFile(configPath, "utf8");
  const config: OpenClawConfig = JSON.parse(configRaw);
  const model = toOpenRouterApiModel(
    config.models?.generation ?? config.models?.default ?? "openrouter/anthropic/claude-3.5-sonnet"
  );

  const combined = [
    "Customer Report:",
    vocReport ?? "(missing)",
    "",
    "Competitor Report:",
    competitorReport ?? "(missing)",
    "",
    "Inventory Report:",
    inventoryReport ?? "(missing)"
  ].join("\n");

  const briefing = await callOpenRouter(
    model,
    [
      { role: "system", content: prompt },
      { role: "user", content: combined }
    ]
  );

  const text = String(briefing).trim();
  console.log("\n=== DAILY EXECUTIVE BRIEFING ===\n");
  console.log(text);

  const outputPath = path.resolve(projectRoot, "reports", "daily_executive.md");
  await fs.writeFile(outputPath, `${text}\n`, "utf8");

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (webhook) {
    try {
      await axios.post(
        webhook,
        { text: `*Daily Executive Briefing*\n\n${text}` },
        { headers: { "Content-Type": "application/json" }, timeout: 30000 }
      );
      console.log("\nSlack delivery: sent.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`\nSlack delivery failed: ${message}`);
    }
  } else {
    console.log("\nSlack delivery skipped (SLACK_WEBHOOK_URL not set).");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Morning briefing failed: ${message}`);
  process.exit(1);
});
