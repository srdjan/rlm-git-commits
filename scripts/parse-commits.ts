/**
 * Structured Git Commit Parser
 *
 * Parses git log output into structured commit objects with typed trailers.
 * Designed for agent memory reconstruction from commit history.
 *
 * Usage:
 *   deno run --allow-run scripts/parse-commits.ts [options]
 *
 * Options:
 *   --limit=N          Number of commits to parse (default: 50)
 *   --intent=TYPE       Filter by intent type
 *   --scope=PATTERN     Filter by scope (substring match)
 *   --session=ID        Filter by session identifier
 *   --decisions-only    Show only commits with Decided-Against trailers
 *   --format=json|text  Output format (default: text)
 *   --since=DATE        Git --since filter
 *   --path=PATH         Git -- path filter
 */

// ---------------------------------------------------------------------------
// Domain Types
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

type IntentType = (typeof INTENT_TYPES)[number];

type ConventionalType =
  | "feat"
  | "fix"
  | "refactor"
  | "perf"
  | "docs"
  | "test"
  | "build"
  | "ci"
  | "chore"
  | "revert";

interface StructuredCommit {
  readonly hash: string;
  readonly date: string;
  readonly type: ConventionalType;
  readonly headerScope: string | null;
  readonly subject: string;
  readonly body: string;
  readonly intent: IntentType | null;
  readonly scope: readonly string[];
  readonly decidedAgainst: readonly string[];
  readonly session: string | null;
  readonly refs: readonly string[];
  readonly context: Record<string, unknown> | null;
  readonly breaking: string | null;
  readonly raw: string;
}

interface ParseError {
  readonly hash: string;
  readonly reason: string;
  readonly raw: string;
}

// ---------------------------------------------------------------------------
// Result Type (inline for zero-dependency script)
// ---------------------------------------------------------------------------

type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

const Result = {
  ok: <T>(value: T): Result<T, never> => ({ ok: true, value }),
  fail: <E>(error: E): Result<never, E> => ({ ok: false, error }),
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const HEADER_RE =
  /^(feat|fix|refactor|perf|docs|test|build|ci|chore|revert)(?:\(([^)]+)\))?!?:\s+(.+)$/;

const TRAILER_RE = /^([A-Za-z][A-Za-z-]*)\s*:\s*(.+)$/;

const isIntentType = (value: string): value is IntentType =>
  (INTENT_TYPES as readonly string[]).includes(value);

const parseTrailers = (
  lines: readonly string[],
): Record<string, readonly string[]> => {
  const trailers: Record<string, string[]> = {};

  for (const line of lines) {
    const match = TRAILER_RE.exec(line.trim());
    if (match) {
      const [, key, value] = match;
      const normalizedKey = key.toLowerCase();
      if (!trailers[normalizedKey]) {
        trailers[normalizedKey] = [];
      }
      trailers[normalizedKey].push(value.trim());
    }
  }

  return trailers;
};

const parseContextJson = (
  raw: string,
): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
};

const splitHeaderBodyTrailers = (
  rawBody: string,
): { body: string; trailerLines: readonly string[] } => {
  const lines = rawBody.split("\n");

  // Find the last contiguous block of trailer-like lines
  let trailerStart = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      // Blank line before trailers — this is the separator
      break;
    }
    if (TRAILER_RE.test(trimmed)) {
      trailerStart = i;
    } else {
      // Non-trailer, non-blank line — trailers haven't started
      trailerStart = lines.length;
      break;
    }
  }

  const body = lines
    .slice(0, trailerStart)
    .join("\n")
    .trim();
  const trailerLines = lines.slice(trailerStart).map((l) => l.trim());

  return { body, trailerLines };
};

const parseCommitBlock = (
  block: string,
): Result<StructuredCommit, ParseError> => {
  const lines = block.trim().split("\n");

  const hashLine = lines.find((l) => l.startsWith("Hash: "));
  const dateLine = lines.find((l) => l.startsWith("Date: "));
  const subjectLine = lines.find((l) => l.startsWith("Subject: "));

  if (!hashLine || !dateLine || !subjectLine) {
    return Result.fail({
      hash: hashLine?.slice(6) ?? "unknown",
      reason: "Missing required fields (Hash, Date, or Subject)",
      raw: block,
    });
  }

  const hash = hashLine.slice(6).trim();
  const date = dateLine.slice(6).trim();
  const fullSubject = subjectLine.slice(9).trim();

  // Parse conventional commit header
  const headerMatch = HEADER_RE.exec(fullSubject);
  if (!headerMatch) {
    return Result.fail({
      hash,
      reason: `Subject doesn't match Conventional Commits format: "${fullSubject}"`,
      raw: block,
    });
  }

  const [, type, headerScope, subject] = headerMatch;

  // Everything after the Subject line is body + trailers
  const subjectIndex = lines.findIndex((l) => l.startsWith("Subject: "));
  const rawBody = lines.slice(subjectIndex + 1).join("\n");
  const { body, trailerLines } = splitHeaderBodyTrailers(rawBody);
  const trailers = parseTrailers(trailerLines);

  // Extract typed trailer values
  const intentRaw = trailers["intent"]?.[0] ?? null;
  const intent = intentRaw && isIntentType(intentRaw) ? intentRaw : null;

  const scopeRaw = trailers["scope"]?.[0] ?? "";
  const scope = scopeRaw
    ? scopeRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const decidedAgainst = trailers["decided-against"] ?? [];

  const session = trailers["session"]?.[0] ?? null;

  const refsRaw = trailers["refs"]?.[0] ?? "";
  const refs = refsRaw
    ? refsRaw.split(",").map((r) => r.trim()).filter(Boolean)
    : [];

  const contextRaw = trailers["context"]?.[0] ?? null;
  const context = contextRaw ? parseContextJson(contextRaw) : null;

  const breaking = trailers["breaking"]?.[0] ?? null;

  return Result.ok({
    hash,
    date,
    type: type as ConventionalType,
    headerScope: headerScope ?? null,
    subject,
    body,
    intent,
    scope,
    decidedAgainst,
    session,
    refs,
    context,
    breaking,
    raw: block,
  });
};

// ---------------------------------------------------------------------------
// Git Integration
// ---------------------------------------------------------------------------

const buildGitArgs = (options: CliOptions): readonly string[] => {
  const args = [
    "log",
    `-${options.limit}`,
    "--format=---commit---%nHash: %H%nDate: %aI%nSubject: %s%n%b",
  ];

  if (options.since) args.push(`--since=${options.since}`);
  if (options.intent) args.push(`--grep=Intent: ${options.intent}`);
  if (options.session) args.push(`--grep=Session: ${options.session}`);
  if (options.path) {
    args.push("--");
    args.push(options.path);
  }

  return args;
};

const execGitLog = async (
  args: readonly string[],
): Promise<Result<string>> => {
  try {
    const command = new Deno.Command("git", { args: [...args], stdout: "piped", stderr: "piped" });
    const output = await command.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      return Result.fail(new Error(`git log failed: ${stderr}`));
    }

    return Result.ok(new TextDecoder().decode(output.stdout));
  } catch (e) {
    return Result.fail(e as Error);
  }
};

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

const applyFilters = (
  commits: readonly StructuredCommit[],
  options: CliOptions,
): readonly StructuredCommit[] => {
  let filtered = [...commits];

  if (options.scope) {
    const pattern = options.scope.toLowerCase();
    filtered = filtered.filter((c) =>
      c.scope.some((s) => s.toLowerCase().includes(pattern))
    );
  }

  if (options.decisionsOnly) {
    filtered = filtered.filter((c) => c.decidedAgainst.length > 0);
  }

  return filtered;
};

// ---------------------------------------------------------------------------
// Output Formatting
// ---------------------------------------------------------------------------

const formatText = (commits: readonly StructuredCommit[]): string => {
  if (commits.length === 0) return "No structured commits found.";

  return commits
    .map((c) => {
      const lines = [
        `${c.hash.slice(0, 8)} ${c.date.slice(0, 10)} [${c.intent ?? "?"}] ${c.type}(${c.headerScope ?? "*"}): ${c.subject}`,
      ];

      if (c.scope.length > 0) {
        lines.push(`  Scope: ${c.scope.join(", ")}`);
      }

      if (c.decidedAgainst.length > 0) {
        for (const d of c.decidedAgainst) {
          lines.push(`  ✗ ${d}`);
        }
      }

      if (c.session) {
        lines.push(`  Session: ${c.session}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
};

const formatJson = (commits: readonly StructuredCommit[]): string =>
  JSON.stringify(commits, null, 2);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  readonly limit: number;
  readonly intent: IntentType | null;
  readonly scope: string | null;
  readonly session: string | null;
  readonly decisionsOnly: boolean;
  readonly format: "json" | "text";
  readonly since: string | null;
  readonly path: string | null;
}

const parseCliArgs = (args: string[]): CliOptions => {
  const get = (key: string): string | null => {
    const arg = args.find((a) => a.startsWith(`--${key}=`));
    return arg ? arg.split("=").slice(1).join("=") : null;
  };

  const has = (key: string): boolean =>
    args.includes(`--${key}`);

  const intentRaw = get("intent");
  const intent = intentRaw && isIntentType(intentRaw) ? intentRaw : null;

  const formatRaw = get("format");
  const format = formatRaw === "json" ? "json" : "text";

  return {
    limit: parseInt(get("limit") ?? "50", 10),
    intent,
    scope: get("scope"),
    session: get("session"),
    decisionsOnly: has("decisions-only"),
    format,
    since: get("since"),
    path: get("path"),
  };
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const options = parseCliArgs(Deno.args);

  const gitArgs = buildGitArgs(options);
  const logResult = await execGitLog(gitArgs);

  if (!logResult.ok) {
    console.error(`Error: ${logResult.error.message}`);
    Deno.exit(1);
  }

  const blocks = logResult.value
    .split("---commit---")
    .filter((b) => b.trim().length > 0);

  const results = blocks.map(parseCommitBlock);

  const commits = results
    .filter((r): r is { ok: true; value: StructuredCommit } => r.ok)
    .map((r) => r.value);

  const errors = results
    .filter((r): r is { ok: false; error: ParseError } => !r.ok)
    .map((r) => r.error);

  const filtered = applyFilters(commits, options);

  const output = options.format === "json"
    ? formatJson(filtered)
    : formatText(filtered);

  console.log(output);

  if (errors.length > 0 && options.format === "text") {
    console.error(
      `\n⚠ ${errors.length} commit(s) could not be parsed (non-structured or malformed)`,
    );
  }
};

main();
