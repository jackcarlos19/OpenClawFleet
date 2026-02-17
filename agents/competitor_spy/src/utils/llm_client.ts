import axios from "axios";
import { promises as fs } from "fs";
import path from "path";
import { ZodSchema } from "zod";

type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function extractFirstJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetriableHttpError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === 429 || (typeof status === "number" && status >= 500);
}

export async function callOpenRouter<T = unknown>(
  model: string,
  messages: OpenRouterMessage[],
  schema?: ZodSchema<T>
): Promise<T | string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }

  const backoffsMs = [2000, 4000, 8000];
  const baseMessages = [...messages];
  let workingMessages = [...baseMessages];
  let validationRetryUsed = false;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model,
          temperature: 0,
          messages: workingMessages
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          timeout: 90000
        }
      );

      const content: string = response.data?.choices?.[0]?.message?.content ?? "";
      if (!content) {
        throw new Error("Model returned empty content.");
      }

      const usage = (response.data?.usage ?? {}) as Record<string, unknown>;
      const logRecord = {
        ts: new Date().toISOString(),
        script: "llm_call",
        model,
        input_tokens:
          (typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0) ||
          (typeof usage.input_tokens === "number" ? usage.input_tokens : 0),
        output_tokens:
          (typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0) ||
          (typeof usage.output_tokens === "number" ? usage.output_tokens : 0),
        success: true
      };
      try {
        const logsDir = path.resolve(__dirname, "..", "..", "logs");
        await fs.mkdir(logsDir, { recursive: true });
        await fs.appendFile(path.join(logsDir, "llm_usage.jsonl"), `${JSON.stringify(logRecord)}\n`, "utf8");
      } catch {
        // Non-blocking: usage logging should never break inference flow.
      }

      if (!schema) {
        return content;
      }

      const parsed = JSON.parse(extractFirstJsonObject(content));
      const validated = schema.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }

      if (!validationRetryUsed) {
        validationRetryUsed = true;
        workingMessages = [
          ...baseMessages,
          { role: "assistant", content },
          {
            role: "user",
            content:
              "You output invalid JSON. Fix it and return ONLY valid JSON that matches the required schema. " +
              `Validation errors: ${validated.error.message}`
          }
        ];
        continue;
      }

      throw new Error(`Schema validation failed after retry: ${validated.error.message}`);
    } catch (error: unknown) {
      if (attempt < 3 && isRetriableHttpError(error)) {
        await sleep(backoffsMs[attempt - 1]);
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`OpenRouter call failed (attempt ${attempt}/3): ${message}`);
    }
  }

  throw new Error("OpenRouter call failed after all retries.");
}
