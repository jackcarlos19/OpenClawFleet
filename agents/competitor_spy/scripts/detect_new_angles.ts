import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";

const AnalysisItemSchema = z.object({
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

const AnalysisFileSchema = z.object({
  generated_at: z.string(),
  model: z.string(),
  source_file: z.string(),
  results: z.array(AnalysisItemSchema)
});

type AnalysisItem = z.infer<typeof AnalysisItemSchema>;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function toDateStamp(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

async function findLatestAnalysisFile(insightsDir: string): Promise<string> {
  const entries = await fs.readdir(insightsDir, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isFile() && /^competitor_analysis_\d{8}\.json$/.test(e.name))
    .map((e) => e.name)
    .sort();
  if (candidates.length === 0) {
    throw new Error("No analysis file found (expected insights/competitor_analysis_YYYYMMDD.json).");
  }
  return path.resolve(insightsDir, candidates[candidates.length - 1]);
}

function parseQuotedValues(line: string): string[] {
  const quotedMatches = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter(Boolean);
  return quotedMatches;
}

function updateKnownAnglesLine(memoryContent: string, newOrderedAngles: string[]): string {
  const lines = memoryContent.split("\n");
  const knownIndex = lines.findIndex((line) => line.includes("**Known Angles:**"));
  const rendered = newOrderedAngles.map((angle) => `"${angle}"`).join(", ");
  const replacement = `- **Known Angles:** ${rendered}`;

  if (knownIndex >= 0) {
    lines[knownIndex] = replacement;
    return lines.join("\n");
  }

  const header = lines.length > 0 && lines[0].startsWith("#") ? [lines[0], replacement] : ["# Competitor Intelligence Memory", replacement];
  const tail = lines.length > 1 ? lines.slice(1) : [];
  return [...header, ...tail].join("\n");
}

async function main(): Promise<void> {
  const agentRoot = path.resolve(__dirname, "..");
  const insightsDir = path.resolve(agentRoot, "insights");
  const memoryPath = path.resolve(agentRoot, "memory", "MEMORY.md");

  const analysisPath = await findLatestAnalysisFile(insightsDir);
  const analysisRaw = await fs.readFile(analysisPath, "utf8");
  const analysis = AnalysisFileSchema.parse(JSON.parse(analysisRaw));

  const memoryRaw = await fs.readFile(memoryPath, "utf8");
  const knownAnglesLine =
    memoryRaw.split("\n").find((line) => line.includes("**Known Angles:**")) ?? "";
  const knownAngles = parseQuotedValues(knownAnglesLine);
  const knownSet = new Set(knownAngles.map((a) => normalize(a)));

  const seenToday = new Set<string>();
  const newItems: AnalysisItem[] = [];
  const newAnglesOrdered: string[] = [];

  for (const item of analysis.results) {
    const angle = item.analysis.main_angle.trim();
    const norm = normalize(angle);
    if (!norm || seenToday.has(`${item.ad.headline}:${norm}`)) continue;
    seenToday.add(`${item.ad.headline}:${norm}`);
    if (!knownSet.has(norm)) {
      newItems.push(item);
      if (!newAnglesOrdered.some((a) => normalize(a) === norm)) {
        newAnglesOrdered.push(angle);
      }
    }
  }

  const mergedKnownAngles = [...knownAngles];
  for (const angle of newAnglesOrdered) {
    if (!mergedKnownAngles.some((existing) => normalize(existing) === normalize(angle))) {
      mergedKnownAngles.push(angle);
    }
  }

  const updatedMemory = updateKnownAnglesLine(memoryRaw, mergedKnownAngles);
  await fs.writeFile(memoryPath, updatedMemory.endsWith("\n") ? updatedMemory : `${updatedMemory}\n`, "utf8");

  const outputPath = path.resolve(insightsDir, `new_trends_${toDateStamp()}.json`);
  const output = {
    generated_at: new Date().toISOString(),
    source_analysis_file: analysisPath,
    known_angles_before: knownAngles,
    newly_detected_angles: newAnglesOrdered,
    fresh_findings: newItems
  };
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log("Delta detection complete.");
  console.log(`- Input analysis: ${analysisPath}`);
  console.log(`- New angles detected: ${newAnglesOrdered.length}`);
  console.log(`- Memory updated: ${memoryPath}`);
  console.log(`- Output: ${outputPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Delta detection failed: ${message}`);
  process.exit(1);
});
