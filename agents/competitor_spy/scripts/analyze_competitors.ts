import dotenv from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { callOpenRouter } from "../src/utils/llm_client";
import { CompetitorAdAnalysisSchema } from "../src/schemas/competitor_ad.schema";

const CompetitorAdInputSchema = z.object({
  ad_text: z.string().min(1),
  headline: z.string().min(1),
  image_description: z.string().min(1)
});

type OpenClawConfig = {
  models?: {
    default?: string;
    extraction?: string;
    generation?: string;
  };
};

function toDateStamp(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function toOpenRouterApiModel(modelId: string): string {
  let normalized = modelId.trim();
  if (normalized.startsWith("openrouter/")) {
    normalized = normalized.slice("openrouter/".length);
  }
  return normalized;
}

async function main(): Promise<void> {
  const agentRoot = path.resolve(__dirname, "..");
  const repoRoot = path.resolve(agentRoot, "..", "..");
  dotenv.config({ path: path.resolve(repoRoot, ".env"), quiet: true });

  const dataPath = path.resolve(agentRoot, "data", "competitor_ads_sample.json");
  const promptPath = path.resolve(agentRoot, "prompts", "analyze_ad.md");
  const configPath = path.resolve(agentRoot, "openclaw.json");
  const insightsDir = path.resolve(agentRoot, "insights");

  const inputRaw = await fs.readFile(dataPath, "utf8");
  const prompt = await fs.readFile(promptPath, "utf8");
  const configRaw = await fs.readFile(configPath, "utf8");

  const inputAds = z.array(CompetitorAdInputSchema).parse(JSON.parse(inputRaw));
  const config: OpenClawConfig = JSON.parse(configRaw);
  const extractionModel = toOpenRouterApiModel(
    config.models?.extraction ?? config.models?.default ?? "openrouter/anthropic/claude-3-haiku"
  );

  const results: Array<{
    ad: z.infer<typeof CompetitorAdInputSchema>;
    analysis: z.infer<typeof CompetitorAdAnalysisSchema>;
  }> = [];

  for (const ad of inputAds) {
    const userInput = [
      `Ad Text: ${ad.ad_text}`,
      `Headline: ${ad.headline}`,
      `Image Description: ${ad.image_description}`
    ].join("\n");

    const analysis = await callOpenRouter(
      extractionModel,
      [
        { role: "system", content: prompt },
        { role: "user", content: userInput }
      ],
      CompetitorAdAnalysisSchema
    );

    results.push({
      ad,
      analysis: analysis as z.infer<typeof CompetitorAdAnalysisSchema>
    });
  }

  await fs.mkdir(insightsDir, { recursive: true });
  const outputPath = path.resolve(insightsDir, `competitor_analysis_${toDateStamp()}.json`);
  const payload = {
    generated_at: new Date().toISOString(),
    model: extractionModel,
    source_file: dataPath,
    results
  };
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log("Competitor analysis complete.");
  console.log(`- Input: ${dataPath}`);
  console.log(`- Model: ${extractionModel}`);
  console.log(`- Ads processed: ${inputAds.length}`);
  console.log(`- Output: ${outputPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Competitor analysis failed: ${message}`);
  process.exit(1);
});
