import { promises as fs } from "fs";
import path from "path";

type Finding = {
  filePath: string;
  lineNumber: number;
  reason: string;
  snippet: string;
};

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

const DIRECT_PATTERNS: Array<{ reason: string; regex: RegExp }> = [
  { reason: "Possible OpenRouter key", regex: /sk-or-[A-Za-z0-9_-]+/g },
  { reason: "Possible Slack bot token", regex: /xoxb-[A-Za-z0-9-]+/g },
  { reason: "Possible GitHub token", regex: /ghp_[A-Za-z0-9]{20,}/g }
];

const KEY_ASSIGNMENT_REGEX =
  /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:key|token|secret|password)[A-Za-z0-9_$]*\s*=\s*["'`]([^"'`]{20,})["'`]/gi;

const IGNORED_DIRS = new Set(["node_modules", ".git", "logs"]);
const IGNORED_FILE_NAMES = new Set(["package-lock.json", ".env"]);

function computeEntropy(input: string): number {
  const freq = new Map<string, number>();
  for (const char of input) {
    freq.set(char, (freq.get(char) ?? 0) + 1);
  }
  const len = input.length;
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function looksHighEntropySecret(value: string): boolean {
  if (value.length < 20) return false;
  const entropy = computeEntropy(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasLower = /[a-z]/.test(value);
  const hasDigit = /\d/.test(value);
  const hasSymbol = /[^A-Za-z0-9]/.test(value);
  const diversityScore = [hasUpper, hasLower, hasDigit, hasSymbol].filter(Boolean).length;
  return entropy >= 3.5 && diversityScore >= 3;
}

async function gatherFiles(targetPath: string): Promise<string[]> {
  let stat;
  try {
    stat = await fs.stat(targetPath);
  } catch {
    return [];
  }

  if (stat.isFile()) {
    const base = path.basename(targetPath);
    if (IGNORED_FILE_NAMES.has(base) || base.startsWith(".env")) return [];
    return [targetPath];
  }

  const out: string[] = [];
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await gatherFiles(fullPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (IGNORED_FILE_NAMES.has(entry.name) || entry.name.startsWith(".env")) continue;
    out.push(fullPath);
  }
  return out;
}

function scanContent(filePath: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");

  lines.forEach((line, index) => {
    for (const pattern of DIRECT_PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(line)) {
        findings.push({
          filePath,
          lineNumber: index + 1,
          reason: pattern.reason,
          snippet: line.trim()
        });
      }
    }

    KEY_ASSIGNMENT_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = KEY_ASSIGNMENT_REGEX.exec(line)) !== null) {
      const candidate = match[1] ?? "";
      if (looksHighEntropySecret(candidate)) {
        findings.push({
          filePath,
          lineNumber: index + 1,
          reason: "High-entropy secret assigned to key/token-like variable",
          snippet: line.trim()
        });
      }
    }
  });

  return findings;
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(__dirname, "..");
  const scanRoots = ["src", "agents", "scripts", "openclaw.json"].map((p) => path.resolve(projectRoot, p));

  const files = (await Promise.all(scanRoots.map((root) => gatherFiles(root)))).flat();
  const uniqueFiles = [...new Set(files)];
  const findings: Finding[] = [];

  for (const filePath of uniqueFiles) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      findings.push(...scanContent(filePath, content));
    } catch {
      // Skip unreadable/non-text files silently.
    }
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(
        `${RED}${finding.filePath}:${finding.lineNumber} - ${finding.reason}\n  ${finding.snippet}${RESET}`
      );
    }
    process.exit(1);
  }

  console.log(`${GREEN}✅ Security Scan Passed${RESET}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${RED}Security scan failed: ${message}${RESET}`);
  process.exit(1);
});
