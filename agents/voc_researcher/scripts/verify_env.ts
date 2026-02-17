import axios from "axios";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

type OpenClawConfig = {
  logging?: {
    directory?: string;
    format?: string;
  };
  models?: {
    default?: string;
    extraction?: string;
    generation?: string;
  };
};

function resolveHomeDir(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

async function ensureWritableDirectory(targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const probeFile = path.join(targetDir, ".write-test.tmp");
  await fs.writeFile(probeFile, "ok", "utf8");
  await fs.unlink(probeFile);
}

function toOpenRouterApiModel(modelId: string): string {
  let normalized = modelId.trim();
  if (normalized.startsWith("openrouter/")) {
    normalized = normalized.slice("openrouter/".length);
  }
  // Handle common alias style from config (claude-3-5-sonnet -> claude-3.5-sonnet).
  normalized = normalized.replace("claude-3-5-sonnet", "claude-3.5-sonnet");
  return normalized;
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(__dirname, "..");
  const configPath = path.join(projectRoot, "openclaw.json");
  const rawConfig = await fs.readFile(configPath, "utf8");
  const config: OpenClawConfig = JSON.parse(rawConfig);

  const configuredLogDir = config.logging?.directory ?? "~/.openclaw/logs";
  const homeLogDir = resolveHomeDir(configuredLogDir);
  await ensureWritableDirectory(homeLogDir);

  const generationModel =
    config.models?.generation ?? config.models?.default ?? "openrouter/anthropic/claude-3-5-sonnet";
  const apiModel = toOpenRouterApiModel(generationModel);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }

  const apiResponse = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: apiModel,
      messages: [{ role: "user", content: "Hello World" }],
      temperature: 0.2
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 60000
    }
  );

  const modelReply = apiResponse.data?.choices?.[0]?.message?.content ?? "";
  if (!modelReply) {
    throw new Error("API response did not include a model message.");
  }

  const localLogsDir = path.join(projectRoot, "logs");
  await fs.mkdir(localLogsDir, { recursive: true });
  const verificationLogPath = path.join(localLogsDir, "verification.jsonl");

  const logRecord = {
    ts: new Date().toISOString(),
    check: "environment_verification",
    model: apiModel,
    prompt: "Hello World",
    response: modelReply
  };

  await fs.appendFile(verificationLogPath, `${JSON.stringify(logRecord)}\n`, "utf8");

  console.log("✅ Environment Verified: API connected and Logs writable.");
}

main().catch((error: unknown) => {
  let message = error instanceof Error ? error.message : String(error);
  if (axios.isAxiosError(error) && error.response?.data) {
    message = `${message} | API: ${JSON.stringify(error.response.data)}`;
  }
  console.error(`Environment verification failed: ${message}`);
  process.exit(1);
});
