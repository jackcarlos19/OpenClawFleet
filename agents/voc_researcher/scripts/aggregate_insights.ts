import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { ReviewInsightSchema } from "../src/schemas/review_insight.schema";

const RawInsightSchema = ReviewInsightSchema.extend({
  review_id: z.string()
}).strict();

const CleanReviewSchema = z
  .object({
    review_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    body: z.string().default(""),
    title: z.string().optional().default("")
  })
  .passthrough();

type RawInsight = z.infer<typeof RawInsightSchema>;
type CleanReview = z.infer<typeof CleanReviewSchema>;

type Args = {
  inputPath: string;
};

function normalizeText(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function toDateStamp(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function parseArgs(argv: string[]): Args {
  const inputPath = argv.find((arg) => !arg.startsWith("--")) ?? "";
  return { inputPath };
}

function extractDateFromFilename(filePath: string): string | null {
  const name = path.basename(filePath);
  const match = name.match(/_(\d{8})\.jsonl$/);
  return match?.[1] ?? null;
}

function toPercent(count: number, total: number): number {
  if (total === 0) return 0;
  return Number(((count / total) * 100).toFixed(2));
}

function rankTop(
  counts: Map<string, { count: number; canonical: string }>,
  topN: number
): Array<{ phrase: string; count: number }> {
  return [...counts.entries()]
    .map(([_, value]) => ({ phrase: value.canonical, count: value.count }))
    .sort((a, b) => (b.count - a.count) || a.phrase.localeCompare(b.phrase))
    .slice(0, topN);
}

function incrementCount(
  map: Map<string, { count: number; canonical: string }>,
  phrase: string
): void {
  const normalized = normalizeText(phrase);
  if (!normalized) return;
  const existing = map.get(normalized);
  if (!existing) {
    map.set(normalized, { count: 1, canonical: phrase.trim() });
    return;
  }
  existing.count += 1;
}

async function findLatestRawInsights(projectRoot: string): Promise<string> {
  const insightsDir = path.join(projectRoot, "insights");
  const entries = await fs.readdir(insightsDir, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isFile() && /^raw_insights_\d{8}\.jsonl$/.test(e.name))
    .map((e) => e.name)
    .sort();

  if (candidates.length === 0) {
    throw new Error("No raw insights file found in insights/ (expected raw_insights_YYYYMMDD.jsonl).");
  }

  return path.join(insightsDir, candidates[candidates.length - 1]);
}

async function resolveCleanReviewsPath(projectRoot: string, dateStamp: string | null): Promise<string | null> {
  const dataDir = path.join(projectRoot, "data");
  if (dateStamp) {
    const candidate = path.join(dataDir, `clean_reviews_${dateStamp}.jsonl`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Fall through to latest-file fallback.
    }
  }

  const entries = await fs.readdir(dataDir, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isFile() && /^clean_reviews_\d{8}\.jsonl$/.test(e.name))
    .map((e) => e.name)
    .sort();
  if (candidates.length === 0) {
    return null;
  }
  return path.join(dataDir, candidates[candidates.length - 1]);
}

function parseJsonl<T>(raw: string, parser: (value: unknown) => T): T[] {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line, index) => {
    try {
      return parser(JSON.parse(line));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSONL at line ${index + 1}: ${message}`);
    }
  });
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(__dirname, "..");
  const { inputPath } = parseArgs(process.argv.slice(2));

  const rawInsightsPath =
    inputPath.length > 0
      ? path.isAbsolute(inputPath)
        ? inputPath
        : path.join(projectRoot, inputPath)
      : await findLatestRawInsights(projectRoot);

  const dateStamp = extractDateFromFilename(rawInsightsPath) ?? toDateStamp();
  const rawInsightsContent = await fs.readFile(rawInsightsPath, "utf8");
  const insights = parseJsonl<RawInsight>(rawInsightsContent, (value) => RawInsightSchema.parse(value));

  const cleanReviewsPath = await resolveCleanReviewsPath(projectRoot, dateStamp);
  const reviewBodyById = new Map<string, string>();
  if (cleanReviewsPath) {
    const cleanContent = await fs.readFile(cleanReviewsPath, "utf8");
    const cleanRows = parseJsonl<CleanReview>(cleanContent, (value) => CleanReviewSchema.parse(value));
    for (const row of cleanRows) {
      reviewBodyById.set(row.review_id, row.body || row.title || "");
    }
  }

  const total = insights.length;
  const sentimentCounts = {
    positive: 0,
    negative: 0,
    neutral: 0
  };
  const painPointCounts = new Map<string, { count: number; canonical: string }>();
  const jobsCounts = new Map<string, { count: number; canonical: string }>();
  const shiftCounts = new Map<string, { count: number; canonical: string }>();

  for (const item of insights) {
    sentimentCounts[item.sentiment] += 1;
    for (const painPoint of item.pain_points) {
      incrementCount(painPointCounts, painPoint);
    }
    incrementCount(jobsCounts, item.jobs_to_be_done);
    if (item.shift_context) {
      incrementCount(shiftCounts, item.shift_context);
    }
  }

  const topPainPoints = rankTop(painPointCounts, 5);
  const topPainPointSet = new Set(topPainPoints.slice(0, 3).map((x) => normalizeText(x.phrase)));
  const topJobs = rankTop(jobsCounts, 3);
  const topShiftContexts = rankTop(shiftCounts, 3);

  const insightsSorted = [...insights].sort((a, b) => Number(a.review_id) - Number(b.review_id));
  const quoteBank: Array<{
    review_id: string;
    matched_pain_point: string | null;
    quote: string;
    sentiment: RawInsight["sentiment"];
  }> = [];
  const addedIds = new Set<string>();

  for (const topPain of topPainPoints.slice(0, 3)) {
    const topPainNormalized = normalizeText(topPain.phrase);
    for (const item of insightsSorted) {
      if (quoteBank.length >= 5) break;
      if (addedIds.has(item.review_id)) continue;
      const hasPain = item.pain_points.some((p) => normalizeText(p) === topPainNormalized);
      if (!hasPain) continue;

      const quote = reviewBodyById.get(item.review_id) || item.pain_points[0] || item.jobs_to_be_done;
      quoteBank.push({
        review_id: item.review_id,
        matched_pain_point: topPain.phrase,
        quote,
        sentiment: item.sentiment
      });
      addedIds.add(item.review_id);
    }
  }

  for (const item of insightsSorted) {
    if (quoteBank.length >= 5) break;
    if (addedIds.has(item.review_id)) continue;
    const matchedPain = item.pain_points.find((p) => topPainPointSet.has(normalizeText(p))) ?? null;
    const quote = reviewBodyById.get(item.review_id) || item.pain_points[0] || item.jobs_to_be_done;
    quoteBank.push({
      review_id: item.review_id,
      matched_pain_point: matchedPain,
      quote,
      sentiment: item.sentiment
    });
    addedIds.add(item.review_id);
  }

  const summary = {
    generated_at: new Date().toISOString(),
    source: {
      raw_insights_file: rawInsightsPath,
      clean_reviews_file: cleanReviewsPath
    },
    totals: {
      records: total
    },
    metrics: {
      top_pain_points: topPainPoints,
      sentiment_distribution: {
        positive: { count: sentimentCounts.positive, percentage: toPercent(sentimentCounts.positive, total) },
        negative: { count: sentimentCounts.negative, percentage: toPercent(sentimentCounts.negative, total) },
        neutral: { count: sentimentCounts.neutral, percentage: toPercent(sentimentCounts.neutral, total) }
      },
      top_jobs_to_be_done: topJobs,
      top_shift_contexts: topShiftContexts
    },
    quote_bank: quoteBank
  };

  await fs.mkdir(path.join(projectRoot, "insights"), { recursive: true });
  const outputPath = path.join(projectRoot, "insights", `summary_${dateStamp}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log("Aggregation complete.");
  console.log(`- Input raw insights: ${rawInsightsPath}`);
  console.log(`- Input clean reviews: ${cleanReviewsPath ?? "(not found)"}`);
  console.log(`- Records processed: ${total}`);
  console.log(`- Output summary: ${outputPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Aggregation failed: ${message}`);
  process.exit(1);
});
