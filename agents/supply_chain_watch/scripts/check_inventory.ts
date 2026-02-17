import dotenv from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { callOpenRouter } from "../src/utils/llm_client";

type OpenClawConfig = {
  models?: {
    default?: string;
    extraction?: string;
    generation?: string;
  };
};

const InventoryRowSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  current_stock: z.coerce.number().nonnegative(),
  daily_sales_velocity: z.coerce.number().positive()
});

type InventoryRow = z.infer<typeof InventoryRowSchema>;

function toOpenRouterApiModel(modelId: string): string {
  let normalized = modelId.trim();
  if (normalized.startsWith("openrouter/")) {
    normalized = normalized.slice("openrouter/".length);
  }
  return normalized;
}

function classifySeverity(daysOfStock: number): "critical" | "warning" {
  return daysOfStock < 7 ? "critical" : "warning";
}

async function main(): Promise<void> {
  const agentRoot = path.resolve(__dirname, "..");
  const repoRoot = path.resolve(agentRoot, "..", "..");
  dotenv.config({ path: path.resolve(repoRoot, ".env"), quiet: true });

  const inventoryPath = path.resolve(agentRoot, "data", "inventory_sample.csv");
  const configPath = path.resolve(agentRoot, "openclaw.json");
  const promptPath = path.resolve(agentRoot, "prompts", "inventory_alert.md");
  const reportsDir = path.resolve(repoRoot, "reports");
  const outputPath = path.resolve(reportsDir, "daily_inventory.md");

  const csvRaw = await fs.readFile(inventoryPath, "utf8");
  const rowsRaw = parse(csvRaw, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, unknown>[];

  const rows: InventoryRow[] = rowsRaw.map((row) => InventoryRowSchema.parse(row));
  const enriched = rows.map((row) => {
    const daysOfStock = row.current_stock / row.daily_sales_velocity;
    return {
      ...row,
      days_of_stock: Number(daysOfStock.toFixed(2)),
      severity: classifySeverity(daysOfStock)
    };
  });

  const atRisk = enriched
    .filter((item) => item.days_of_stock < 14)
    .sort((a, b) => a.days_of_stock - b.days_of_stock);

  await fs.mkdir(reportsDir, { recursive: true });

  if (atRisk.length === 0) {
    const noRiskReport = [
      "# Daily Inventory Watchdog",
      "",
      "## Inventory Risk Alert",
      "- No low-stock SKUs detected (all items have >= 14 Days of Stock).",
      "",
      "## Ad Spend Action",
      "- No ad pauses required today.",
      "",
      "## Restock Priority",
      "- Monitor as usual."
    ].join("\n");
    await fs.writeFile(outputPath, `${noRiskReport}\n`, "utf8");
    console.log("Inventory check complete (no risk).");
    console.log(`- Input: ${inventoryPath}`);
    console.log(`- Output: ${outputPath}`);
    return;
  }

  const configRaw = await fs.readFile(configPath, "utf8");
  const prompt = await fs.readFile(promptPath, "utf8");
  const config: OpenClawConfig = JSON.parse(configRaw);
  const model = toOpenRouterApiModel(
    config.models?.extraction ?? config.models?.default ?? "openrouter/anthropic/claude-3-haiku"
  );

  const report = await callOpenRouter(
    model,
    [
      { role: "system", content: prompt },
      {
        role: "user",
        content: `Low-stock inventory items (Days of Stock < 14):\n\n${JSON.stringify(atRisk, null, 2)}`
      }
    ]
  );

  await fs.writeFile(outputPath, `${String(report).trim()}\n`, "utf8");
  console.log("Inventory check complete.");
  console.log(`- Input: ${inventoryPath}`);
  console.log(`- At-risk SKUs: ${atRisk.length}`);
  console.log(`- Model: ${model}`);
  console.log(`- Output: ${outputPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Inventory check failed: ${message}`);
  process.exit(1);
});
