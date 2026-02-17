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

function toSlackPayload(targetAudience: string, painPoints: string[], hook: string, briefPath: string) {
  const fallbackUrl = "https://example.com/creative-brief";
  return {
    text: `New Creative Brief Generated: ${targetAudience}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `🎨 New Creative Brief Generated: ${targetAudience}`,
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Top 3 Pain Points*\n• ${painPoints[0]}\n• ${painPoints[1]}\n• ${painPoints[2]}`
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Scroll-Stopping Hook*\n>${hook}`
        }
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "View Full Brief",
              emoji: true
            },
            url: fallbackUrl
          }
        ]
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Local brief path: \`${briefPath}\``
          }
        ]
      }
    ]
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
  const payload = toSlackPayload(
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

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    await logDeliveryError(projectRoot, {
      ts: new Date().toISOString(),
      error: "SLACK_WEBHOOK_URL is not set.",
      brief_file: resolvedInput
    });
    console.warn("Slack delivery skipped: SLACK_WEBHOOK_URL is not set. Logged to logs/delivery_errors.jsonl.");
    return;
  }

  try {
    await axios.post(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 30000
    });
    console.log("Slack delivery sent successfully.");
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
    console.warn("Slack delivery failed; error logged to logs/delivery_errors.jsonl.");
  }
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Slack delivery script failed: ${message}`);
  process.exit(1);
});
