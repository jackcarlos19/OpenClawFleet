import dotenv from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import pLimit from "p-limit";
import { z } from "zod";
import { ReviewInsightSchema, type ReviewInsight } from "../src/schemas/review_insight.schema";
import { callOpenRouter } from "../src/utils/llm_client";

dotenv.config({ quiet: true });

const CleanReviewSchema = z.object({
  review_id: z.string(),
  title: z.string().optional().default(""),
  body: z.string().optional().default(""),
  rating: z.number().nullable().optional(),
  timestamp: z.string().nullable().optional(),
  language: z.enum(["en", "non-en", "unknown"]).optional(),
  pii_masked: z.boolean().optional()
});

type CleanReview = z.infer<typeof CleanReviewSchema>;

type OpenClawConfig = {
  models?: {
    default?: string;
    extraction?: string;
    generation?: string;
  };
};

type Args = {
  inputPath: string;
  limit: number | null;
  concurrency: number;
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
  normalized = normalized.replace("claude-3-5-sonnet", "claude-3.5-sonnet");
  return normalized;
}

function parseArgs(argv: string[]): Args {
  let inputPath = "";
  let limit: number | null = null;
  let concurrency = 5;

  for (const arg of argv) {
    if (arg.startsWith("--limit=")) {
      const n = Number(arg.split("=")[1]);
      limit = Number.isFinite(n) && n > 0 ? n : null;
      continue;
    }
    if (arg.startsWith("--concurrency=")) {
      const n = Number(arg.split("=")[1]);
      concurrency = Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
      continue;
    }
    if (!arg.startsWith("--") && !inputPath) {
      inputPath = arg;
    }
  }

  return { inputPath, limit, concurrency };
}

function formatReviewText(review: CleanReview): string {
  const title = review.title?.trim() ?? "";
  const body = review.body?.trim() ?? "";
  if (title && body) return `Title: ${title}\nBody: ${body}`;
  return title || body || "(empty review)";
}

async function findLatestCleanFile(projectRoot: string): Promise<string> {
  const dataDir = path.join(projectRoot, "data");
  const entries = await fs.readdir(dataDir, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isFile() && /^clean_reviews_\d{8}\.jsonl$/.test(e.name))
    .map((e) => e.name)
    .sort();
  if (candidates.length === 0) {
    throw new Error("No clean reviews file found in data/ (expected clean_reviews_YYYYMMDD.jsonl).");
  }
  return path.join(dataDir, candidates[candidates.length - 1]);
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(__dirname, "..");
  const args = parseArgs(process.argv.slice(2));

  const configPath = path.join(projectRoot, "openclaw.json");
  const configRaw = await fs.readFile(configPath, "utf8");
  const config: OpenClawConfig = JSON.parse(configRaw);
  const configuredModel =
    config.models?.extraction ?? config.models?.default ?? "openrouter/anthropic/claude-3-haiku";
  const extractionModel = toOpenRouterApiModel(configuredModel);

  const promptPath = path.join(projectRoot, "prompts", "extract_review.md");
  const systemPrompt = await fs.readFile(promptPath, "utf8");

  const inputPath =
    args.inputPath.length > 0
      ? path.isAbsolute(args.inputPath)
        ? args.inputPath
        : path.join(projectRoot, args.inputPath)
      : await findLatestCleanFile(projectRoot);

  const inputRaw = await fs.readFile(inputPath, "utf8");
  const lines = inputRaw.split("\n").map((line) => line.trim()).filter(Boolean);
  const selectedLines = args.limit ? lines.slice(0, args.limit) : lines;
  const reviews = selectedLines.map((line, index) => {
    try {
      return CleanReviewSchema.parse(JSON.parse(line));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSONL at line ${index + 1}: ${message}`);
    }
  });

  await fs.mkdir(path.join(projectRoot, "insights"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "logs"), { recursive: true });

  const outputPath = path.join(projectRoot, "insights", `raw_insights_${toDateStamp()}.jsonl`);
  const errorPath = path.join(projectRoot, "logs", "extraction_errors.jsonl");

  const limit = pLimit(args.concurrency);
  let successCount = 0;
  let failedCount = 0;

  await Promise.all(
    reviews.map((review) =>
      limit(async () => {
        const reviewText = formatReviewText(review);
        try {
          const insight = (await callOpenRouter(
            extractionModel,
            [
              { role: "system", content: systemPrompt },
              { role: "user", content: reviewText }
            ],
            ReviewInsightSchema
          )) as ReviewInsight;
          const outRecord = {
            review_id: review.review_id,
            ...insight
          };
          await fs.appendFile(outputPath, `${JSON.stringify(outRecord)}\n`, "utf8");
          successCount += 1;
        } catch (error) {
          const lastError = error instanceof Error ? error.message : String(error);
          failedCount += 1;
          const errRecord = {
            ts: new Date().toISOString(),
            review_id: review.review_id,
            error: lastError
          };
          await fs.appendFile(errorPath, `${JSON.stringify(errRecord)}\n`, "utf8");
        }
      })
    )
  );

  console.log("Extraction complete.");
  console.log(`- Input file: ${inputPath}`);
  console.log(`- Rows processed: ${reviews.length}`);
  console.log(`- Success: ${successCount}`);
  console.log(`- Failed: ${failedCount}`);
  console.log(`- Output: ${outputPath}`);
  if (failedCount > 0) {
    console.log(`- Errors: ${errorPath}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Extraction failed: ${message}`);
  process.exit(1);
});
