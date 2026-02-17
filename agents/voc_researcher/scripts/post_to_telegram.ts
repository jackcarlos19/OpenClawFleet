import axios from "axios";
import dotenv from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import { CreativeBriefSchema } from "../src/schemas/creative_brief.schema";

dotenv.config({ quiet: true });

type Args = {
  inputPath: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const dryRun = argv.includes("--dry-run");
  const inputPath = argv.find((arg) => !arg.startsWith("--")) ?? "";
  return { inputPath, dryRun };
}

async function findLatestBriefFile(projectRoot: string): Promise<string> {
  const briefsDir = path.join(projectRoot, "briefs");
  const entries = await fs.readdir(briefsDir, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isFile() && /^creative_brief_\d{8}\.json$/.test(e.name))
    .map((e) => e.name)
    .sort();

  if (candidates.length === 0) {
    throw new Error("No creative brief file found in briefs/ (expected creative_brief_YYYYMMDD.json).");
  }

  return path.join(briefsDir, candidates[candidates.length - 1]);
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function toTelegramPayload(targetAudience: string, painPoints: string[], hook: string, briefPath: string) {
  const fallbackUrl = "https://example.com/creative-brief";
  const cleanedHook = hook.trim().replace(/^"+|"+$/g, "");
  const lines = [
    `<b>🎨 New Creative Brief Generated: ${escapeHtml(targetAudience)}</b>`,
    "",
    "<b>Top 3 Pain Points</b>",
    `• ${escapeHtml(painPoints[0] ?? "")}`,
    `• ${escapeHtml(painPoints[1] ?? "")}`,
    `• ${escapeHtml(painPoints[2] ?? "")}`,
    "",
    "<b>Scroll-Stopping Hook</b>",
    `"${escapeHtml(cleanedHook)}"`,
    "",
    `<b>Local brief path:</b> <code>${escapeHtml(briefPath)}</code>`
  ];

  return {
    text: lines.join("\n"),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "View Full Brief",
            url: fallbackUrl
          }
        ]
      ]
    }
  };
}

async function logDeliveryError(projectRoot: string, details: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.join(projectRoot, "logs"), { recursive: true });
  const errorLogPath = path.join(projectRoot, "logs", "delivery_errors.jsonl");
  await fs.appendFile(errorLogPath, `${JSON.stringify(details)}\n`, "utf8");
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(__dirname, "..");
  const { inputPath, dryRun } = parseArgs(process.argv.slice(2));
  const resolvedInput =
    inputPath.length > 0
      ? path.isAbsolute(inputPath)
        ? inputPath
        : path.join(projectRoot, inputPath)
      : await findLatestBriefFile(projectRoot);

  const rawBrief = await fs.readFile(resolvedInput, "utf8");
  const creativeBrief = CreativeBriefSchema.parse(JSON.parse(rawBrief));
  const randomHook = pickRandom(creativeBrief.hooks);
  const payload = toTelegramPayload(
    creativeBrief.target_audience,
    creativeBrief.core_pain_points.slice(0, 3),
    randomHook,
    resolvedInput
  );

  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    console.log("Dry run complete: payload printed, not sent.");
    return;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    await logDeliveryError(projectRoot, {
      ts: new Date().toISOString(),
      error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set.",
      brief_file: resolvedInput
    });
    console.warn("Telegram delivery skipped: missing token/chat id. Logged to logs/delivery_errors.jsonl.");
    return;
  }

  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    await axios.post(
      endpoint,
      {
        chat_id: chatId,
        ...payload
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 30000
      }
    );
    console.log("Telegram delivery sent successfully.");
  } catch (error: unknown) {
    const message =
      axios.isAxiosError(error)
        ? `${error.message} | status=${error.response?.status ?? "unknown"}`
        : error instanceof Error
          ? error.message
          : String(error);
    await logDeliveryError(projectRoot, {
      ts: new Date().toISOString(),
      error: message,
      brief_file: resolvedInput
    });
    console.warn("Telegram delivery failed; error logged to logs/delivery_errors.jsonl.");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Telegram delivery script failed: ${message}`);
  process.exit(1);
});
