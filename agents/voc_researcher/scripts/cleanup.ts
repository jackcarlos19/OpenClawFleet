import { promises as fs } from "fs";
import path from "path";

async function moveFile(source: string, target: string): Promise<void> {
  try {
    await fs.rename(source, target);
  } catch {
    const content = await fs.readFile(source);
    await fs.writeFile(target, content);
    await fs.unlink(source);
  }
}

async function archiveLogs(projectRoot: string): Promise<number> {
  const logsDir = path.join(projectRoot, "logs");
  const archiveDir = path.join(logsDir, "archive");
  await fs.mkdir(archiveDir, { recursive: true });

  let moved = 0;
  const entries = await fs.readdir(logsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const source = path.join(logsDir, entry.name);
    const target = path.join(archiveDir, `${Date.now()}_${entry.name}`);
    await moveFile(source, target);
    moved += 1;
  }
  return moved;
}

async function removeTemporaryTests(projectRoot: string): Promise<number> {
  const candidates = [path.join(projectRoot, "tests", "hello_world_agent.ts")];
  let removed = 0;
  for (const filePath of candidates) {
    try {
      await fs.unlink(filePath);
      removed += 1;
    } catch {
      // Ignore missing files.
    }
  }
  return removed;
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(__dirname, "..");
  const movedLogs = await archiveLogs(projectRoot);
  const removedTests = await removeTemporaryTests(projectRoot);

  console.log("Cleanup prepared.");
  console.log(`- Archived log files: ${movedLogs}`);
  console.log(`- Removed temp test files: ${removedTests}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Cleanup failed: ${message}`);
  process.exit(1);
});
