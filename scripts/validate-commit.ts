/**
 * Structured Commit Validator
 *
 * Validates a commit message against the structured git commits specification.
 * Can be used as a git commit-msg hook or standalone validator.
 *
 * Usage as git hook:
 *   Copy to .git/hooks/commit-msg and make executable, or:
 *   deno run --allow-read scripts/validate-commit.ts "$1"
 *
 * Usage standalone:
 *   echo "feat(auth): add login" | deno run scripts/validate-commit.ts --stdin
 *   deno run --allow-read scripts/validate-commit.ts path/to/commit-msg-file
 */

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

const INTENT_TYPES = [
  "enable-capability",
  "fix-defect",
  "improve-quality",
  "restructure",
  "configure-infra",
  "document",
  "explore",
  "resolve-blocker",
] as const;

const CONVENTIONAL_TYPES = [
  "feat", "fix", "refactor", "perf", "docs",
  "test", "build", "ci", "chore", "revert",
] as const;

type Severity = "error" | "warning";

interface Diagnostic {
  readonly severity: Severity;
  readonly rule: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Validation Rules
// ---------------------------------------------------------------------------

const HEADER_RE =
  /^(feat|fix|refactor|perf|docs|test|build|ci|chore|revert)(?:\(([^)]+)\))?!?:\s+(.+)$/;

const SESSION_RE = /^\d{4}-\d{2}-\d{2}\/.+$/;

const validateHeader = (header: string): readonly Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  if (header.length > 72) {
    diagnostics.push({
      severity: "error",
      rule: "header-max-length",
      message: `Header is ${header.length} chars (max 72): "${header.slice(0, 40)}..."`,
    });
  }

  const match = HEADER_RE.exec(header);
  if (!match) {
    diagnostics.push({
      severity: "error",
      rule: "header-format",
      message: `Header must match <type>(<scope>): <subject>. Got: "${header}"`,
    });
    return diagnostics;
  }

  const [, _type, _scope, subject] = match;

  if (subject.endsWith(".")) {
    diagnostics.push({
      severity: "warning",
      rule: "subject-no-period",
      message: "Subject should not end with a period",
    });
  }

  // Heuristic: imperative mood check
  const firstWord = subject.split(" ")[0].toLowerCase();
  if (firstWord.endsWith("ed") || firstWord.endsWith("ing")) {
    diagnostics.push({
      severity: "warning",
      rule: "subject-imperative",
      message: `Subject may not be imperative mood: "${firstWord}" — use "add" not "added"/"adding"`,
    });
  }

  return diagnostics;
};

const validateTrailers = (
  lines: readonly string[],
): readonly Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const trailers: Record<string, string[]> = {};

  const trailerRe = /^([A-Za-z][A-Za-z-]*)\s*:\s*(.+)$/;

  for (const line of lines) {
    const match = trailerRe.exec(line.trim());
    if (match) {
      const [, key, value] = match;
      const k = key.toLowerCase();
      if (!trailers[k]) trailers[k] = [];
      trailers[k].push(value.trim());
    }
  }

  // Required: Intent
  if (!trailers["intent"] || trailers["intent"].length === 0) {
    diagnostics.push({
      severity: "error",
      rule: "intent-required",
      message: "Missing required trailer: Intent",
    });
  } else {
    const intent = trailers["intent"][0];
    if (!(INTENT_TYPES as readonly string[]).includes(intent)) {
      diagnostics.push({
        severity: "error",
        rule: "intent-valid",
        message: `Invalid intent "${intent}". Valid: ${INTENT_TYPES.join(", ")}`,
      });
    }
    if (trailers["intent"].length > 1) {
      diagnostics.push({
        severity: "error",
        rule: "intent-single",
        message: "Only one Intent trailer allowed per commit",
      });
    }
  }

  // Required: Scope
  if (!trailers["scope"] || trailers["scope"].length === 0) {
    diagnostics.push({
      severity: "error",
      rule: "scope-required",
      message: "Missing required trailer: Scope",
    });
  } else {
    const scopes = trailers["scope"][0].split(",").map((s) => s.trim());
    if (scopes.length > 3) {
      diagnostics.push({
        severity: "warning",
        rule: "scope-max-entries",
        message: `${scopes.length} scope entries — consider splitting this commit (max 3 recommended)`,
      });
    }
  }

  // Optional: Session format
  if (trailers["session"]) {
    const session = trailers["session"][0];
    if (!SESSION_RE.test(session)) {
      diagnostics.push({
        severity: "warning",
        rule: "session-format",
        message: `Session should match YYYY-MM-DD/slug format. Got: "${session}"`,
      });
    }
  }

  // Optional: Context must be valid JSON
  if (trailers["context"]) {
    try {
      JSON.parse(trailers["context"][0]);
    } catch {
      diagnostics.push({
        severity: "error",
        rule: "context-valid-json",
        message: "Context trailer must be valid JSON",
      });
    }
  }

  return diagnostics;
};

const validateBody = (body: string, header: string): readonly Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  // Body can be omitted for trivial changes but warn
  if (body.trim().length === 0) {
    const match = HEADER_RE.exec(header);
    const type = match?.[1] ?? "";
    const trivialTypes = ["chore", "ci", "build"];

    if (!trivialTypes.includes(type)) {
      diagnostics.push({
        severity: "warning",
        rule: "body-present",
        message: "Body is empty — explain what changed and why",
      });
    }
  }

  return diagnostics;
};

// ---------------------------------------------------------------------------
// Main Validation Pipeline
// ---------------------------------------------------------------------------

const validate = (message: string): readonly Diagnostic[] => {
  const lines = message.trim().split("\n");
  if (lines.length === 0) {
    return [{
      severity: "error",
      rule: "non-empty",
      message: "Commit message is empty",
    }];
  }

  const header = lines[0];

  // Find trailer block (last contiguous block of Key: Value lines)
  const trailerRe = /^[A-Za-z][A-Za-z-]*\s*:\s*.+$/;
  let trailerStart = lines.length;
  for (let i = lines.length - 1; i >= 1; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "") break;
    if (trailerRe.test(trimmed)) {
      trailerStart = i;
    } else {
      trailerStart = lines.length;
      break;
    }
  }

  const bodyLines = lines.slice(1, trailerStart);
  const body = bodyLines.join("\n").trim();
  const trailerLines = lines.slice(trailerStart);

  return [
    ...validateHeader(header),
    ...validateBody(body, header),
    ...validateTrailers(trailerLines),
  ];
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const readInput = async (): Promise<string> => {
  const args = Deno.args;

  if (args.includes("--stdin")) {
    const buf = new Uint8Array(1024 * 64);
    const n = await Deno.stdin.read(buf);
    return new TextDecoder().decode(buf.subarray(0, n ?? 0));
  }

  const filePath = args.find((a) => !a.startsWith("--"));
  if (filePath) {
    return await Deno.readTextFile(filePath);
  }

  console.error("Usage: validate-commit.ts <file> or --stdin");
  Deno.exit(2);
};

const formatDiagnostic = (d: Diagnostic): string => {
  const icon = d.severity === "error" ? "✗" : "⚠";
  return `  ${icon} [${d.rule}] ${d.message}`;
};

const main = async (): Promise<void> => {
  const message = await readInput();
  const diagnostics = validate(message);

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  if (diagnostics.length === 0) {
    console.log("✓ Commit message is valid");
    Deno.exit(0);
  }

  if (errors.length > 0) {
    console.error("Commit message validation failed:\n");
    errors.forEach((d) => console.error(formatDiagnostic(d)));
  }

  if (warnings.length > 0) {
    console.warn("\nWarnings:\n");
    warnings.forEach((d) => console.warn(formatDiagnostic(d)));
  }

  Deno.exit(errors.length > 0 ? 1 : 0);
};

main();
