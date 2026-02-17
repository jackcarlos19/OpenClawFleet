import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { parse } from "csv-parse/sync";
import { z } from "zod";

type LanguageLabel = "en" | "non-en" | "unknown";

const IngestRecordSchema = z.object({
  review_id: z.string(),
  title: z.string(),
  body: z.string(),
  rating: z.number().nullable(),
  timestamp: z.string().nullable(),
  language: z.enum(["en", "non-en", "unknown"]),
  pii_masked: z.boolean()
});

type IngestRecord = z.infer<typeof IngestRecordSchema>;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeHeaderKey(key: string): string {
  return normalizeWhitespace(key).toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeModelFields(row: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeHeaderKey(key)] = normalizeWhitespace(String(value ?? ""));
  }
  return normalized;
}

function coerceRating(input: string): number | null {
  if (!input) return null;
  const n = Number(input);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 5) return null;
  return n;
}

function maskPii(text: string): { value: string; changed: boolean } {
  let masked = text;
  const original = text;

  masked = masked.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "[REDACTED_EMAIL]"
  );
  masked = masked.replace(
    /(?:\+?\d{1,3}[\s\-().]*)?(?:\d[\s\-().]*){7,}\d/g,
    "[REDACTED_PHONE]"
  );
  masked = masked.replace(/\b(my name is|i am|i'm)\s+([a-z]+(?:\s+[a-z]+){0,2})\b/gi, (_, prefix: string, nameChunk: string) => {
    const stopWords = new Set(["and", "my", "email", "phone", "number"]);
    const words = nameChunk.split(/\s+/);
    const stopIndex = words.findIndex((w) => stopWords.has(w.toLowerCase()));
    if (stopIndex > 0) {
      const tail = words.slice(stopIndex).join(" ");
      return `${prefix} [REDACTED_NAME] ${tail}`;
    }
    if (stopIndex === 0) {
      return `${prefix} [REDACTED_NAME]`;
    }
    return `${prefix} [REDACTED_NAME]`;
  });

  return { value: masked, changed: masked !== original };
}

function detectLanguage(text: string): LanguageLabel {
  const cleaned = normalizeWhitespace(text);
  if (!cleaned) return "unknown";

  const totalChars = cleaned.length;
  const latinChars = (cleaned.match(/[A-Za-z]/g) ?? []).length;
  const nonLatinChars = (cleaned.match(/[^\x00-\x7F]/g) ?? []).length;

  if (nonLatinChars > 0 && nonLatinChars / Math.max(totalChars, 1) > 0.2) {
    return "non-en";
  }

  if (latinChars === 0) return "unknown";

  const lower = ` ${cleaned.toLowerCase()} `;
  const spanishSignals = [
    " el ",
    " la ",
    " los ",
    " las ",
    " me ",
    " estos ",
    " estas ",
    " zapatos ",
    " muy ",
    " para ",
    " trabajo "
  ];
  const spanishScore = spanishSignals.reduce((acc, term) => acc + (lower.includes(term) ? 1 : 0), 0);
  if (spanishScore >= 2) return "non-en";

  const englishSignals = [
    "the",
    "and",
    "is",
    "my",
    "for",
    "with",
    "this",
    "that",
    "very",
    "shoe",
    "work",
    "shift",
    "feet"
  ];
  const score = englishSignals.reduce((acc, term) => acc + (lower.includes(` ${term} `) ? 1 : 0), 0);

  if (score >= 2 || latinChars / totalChars > 0.7) return "en";
  return "unknown";
}

function makeReviewId(rawId: string, title: string, body: string, rowIndex: number): string {
  if (rawId) return rawId;
  const seed = `${title}|${body}|${rowIndex}`;
  return crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16);
}

function toDateStamp(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function parseArgs(argv: string[]): { inputPath: string; nonEnglishMode: "mark" | "filter" } {
  const args = [...argv];
  const modeArg = args.find((a) => a.startsWith("--non-english="));
  const nonEnglishMode = modeArg?.split("=")[1] === "filter" ? "filter" : "mark";
  const inputPath = args.find((a) => !a.startsWith("--")) ?? "";
  return { inputPath, nonEnglishMode };
}

async function main(): Promise<void> {
  const { inputPath, nonEnglishMode } = parseArgs(process.argv.slice(2));
  if (!inputPath) {
    console.error("Usage: npx tsx scripts/ingest_reviews.ts <path-to-reviews.csv> [--non-english=mark|filter]");
    process.exit(1);
  }

  const projectRoot = path.resolve(__dirname, "..");
  const csvPath = path.isAbsolute(inputPath) ? inputPath : path.join(projectRoot, inputPath);
  const csvRaw = await fs.readFile(csvPath, "utf8");

  const rows = parse(csvRaw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    trim: true
  }) as Record<string, unknown>[];

  const dedup = new Set<string>();
  const accepted: IngestRecord[] = [];
  let droppedNonEnglish = 0;

  rows.forEach((rawRow, idx) => {
    const row = normalizeModelFields(rawRow);

    const title = row.title ?? row.review_title ?? "";
    const body = row.body ?? row.review_body ?? row.content ?? row.text ?? "";
    const reviewId = makeReviewId(row.review_id ?? row.id ?? "", title, body, idx + 1);
    const rating = coerceRating(row.rating ?? row.stars ?? "");
    const timestamp = row.timestamp ?? row.created_at ?? row.date ?? "";

    const dedupKey = normalizeWhitespace(`${reviewId}|${title}|${body}`).toLowerCase();
    if (dedup.has(dedupKey)) return;
    dedup.add(dedupKey);

    const maskedTitle = maskPii(title);
    const maskedBody = maskPii(body);
    const language = detectLanguage(`${maskedTitle.value} ${maskedBody.value}`);

    if (nonEnglishMode === "filter" && language === "non-en") {
      droppedNonEnglish += 1;
      return;
    }

    const candidate: IngestRecord = IngestRecordSchema.parse({
      review_id: reviewId,
      title: normalizeWhitespace(maskedTitle.value),
      body: normalizeWhitespace(maskedBody.value),
      rating,
      timestamp: timestamp ? normalizeWhitespace(timestamp) : null,
      language,
      pii_masked: maskedTitle.changed || maskedBody.changed
    });

    if (!candidate.title && !candidate.body) return;
    accepted.push(candidate);
  });

  await fs.mkdir(path.join(projectRoot, "data"), { recursive: true });
  const outputFile = path.join(projectRoot, "data", `clean_reviews_${toDateStamp()}.jsonl`);
  const jsonl = accepted.map((record) => JSON.stringify(record)).join("\n");
  await fs.writeFile(outputFile, jsonl ? `${jsonl}\n` : "", "utf8");

  console.log(`Ingestion complete.`);
  console.log(`- Input rows: ${rows.length}`);
  console.log(`- Output rows: ${accepted.length}`);
  console.log(`- Dropped non-English rows: ${droppedNonEnglish}`);
  console.log(`- Output file: ${outputFile}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Ingest failed: ${message}`);
  process.exit(1);
});
