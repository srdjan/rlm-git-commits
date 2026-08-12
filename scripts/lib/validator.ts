/**
 * Pure validation functions for structured git commit messages.
 *
 * Validates commit messages against the structured git commits specification.
 * All functions are pure and side-effect free.
 */

import {
  type Diagnostic,
  INTENT_TYPES,
  KNOWN_TRAILER_KEYS,
} from "../types.ts";

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const HEADER_RE =
  /^(feat|fix|refactor|perf|docs|test|build|ci|chore|revert)(?:\(([^)]+)\))?!?:\s+(.+)$/;

const SESSION_RE = /^\d{4}-\d{2}-\d{2}\/.+$/;

const TRAILER_RE = /^([A-Za-z][A-Za-z-]*)\s*:\s*(.+)$/;

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Recommended header length (Chris Beams rule 2, adjusted for the type prefix). */
const HEADER_SOFT_LIMIT = 50;

/** Hard header ceiling - git tooling truncates beyond this. */
const HEADER_HARD_LIMIT = 72;

/** Body wrap column (Chris Beams rule 6). */
const BODY_WRAP_LIMIT = 72;

/**
 * First words that are third-person indicative, not imperative.
 * "Adds login" describes; "Add login" commands.
 */
const NON_IMPERATIVE_WORDS = new Set([
  "adds",
  "allows",
  "changes",
  "creates",
  "deletes",
  "enables",
  "fixes",
  "implements",
  "improves",
  "makes",
  "moves",
  "prevents",
  "removes",
  "renames",
  "supports",
  "updates",
]);

/** Imperative verbs that end in -ed or -ing and would trip the suffix heuristic. */
const IMPERATIVE_EXCEPTIONS = new Set([
  "bring",
  "embed",
  "feed",
  "need",
  "seed",
  "shed",
  "speed",
  "spread",
  "string",
]);

/** Subjects that legitimately start lowercase: code identifiers and flags. */
const CODE_LIKE_FIRST_WORD = /^`|[A-Z_./()]/;

// ---------------------------------------------------------------------------
// Header Validation
// ---------------------------------------------------------------------------

export const validateHeader = (header: string): readonly Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  if (header.length > HEADER_HARD_LIMIT) {
    diagnostics.push({
      severity: "error",
      rule: "header-max-length",
      message:
        `Header is ${header.length} chars (max ${HEADER_HARD_LIMIT}): "${header.slice(0, 40)}..."`,
    });
  } else if (header.length > HEADER_SOFT_LIMIT) {
    diagnostics.push({
      severity: "warning",
      rule: "header-recommended-length",
      message:
        `Header is ${header.length} chars (recommended max ${HEADER_SOFT_LIMIT}) - tighten the subject`,
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

  const firstWord = subject.split(/\s+/)[0] ?? "";

  // Capitalized subject, unless the first word is a code identifier or flag
  if (/^[a-z]/.test(subject) && !CODE_LIKE_FIRST_WORD.test(firstWord)) {
    diagnostics.push({
      severity: "warning",
      rule: "subject-capitalized",
      message:
        `Subject should start with a capital letter: "${firstWord}" - use "Add" not "add"`,
    });
  }

  // Heuristic: imperative mood check
  const lowerFirst = firstWord.toLowerCase();
  const suffixSuspect = (lowerFirst.endsWith("ed") || lowerFirst.endsWith("ing")) &&
    !IMPERATIVE_EXCEPTIONS.has(lowerFirst);
  if (suffixSuspect || NON_IMPERATIVE_WORDS.has(lowerFirst)) {
    diagnostics.push({
      severity: "warning",
      rule: "subject-imperative",
      message:
        `Subject may not be imperative mood: "${lowerFirst}" - use "add" not "added"/"adding"/"adds"`,
    });
  }

  return diagnostics;
};

// ---------------------------------------------------------------------------
// Trailer Validation
// ---------------------------------------------------------------------------

export const validateTrailers = (
  lines: readonly string[],
): readonly Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const trailers: Record<string, string[]> = {};

  for (const line of lines) {
    const match = TRAILER_RE.exec(line.trim());
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
        message: `${scopes.length} scope entries - consider splitting this commit (max 3 recommended)`,
      });
    }
    // Warn when a scope entry doesn't contain a slash
    for (const s of scopes) {
      if (s && !s.includes("/")) {
        diagnostics.push({
          severity: "warning",
          rule: "scope-format",
          message: `Scope "${s}" should use domain/module format (e.g., auth/session)`,
        });
      }
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

// ---------------------------------------------------------------------------
// Body Validation
// ---------------------------------------------------------------------------

export const validateBody = (
  body: string,
  header: string,
): readonly Diagnostic[] => {
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
        message: "Body is empty - explain what changed and why",
      });
    }
    return diagnostics;
  }

  const overflow = findOverflowingLines(body.split("\n"));
  if (overflow.length > 0) {
    const [first] = overflow;
    diagnostics.push({
      severity: "warning",
      rule: "body-wrap",
      message:
        `${overflow.length} body line(s) exceed ${BODY_WRAP_LIMIT} chars (first: line ${first.line}, ${first.length} chars) - wrap the body at ${BODY_WRAP_LIMIT}`,
    });
  }

  return diagnostics;
};

/**
 * Body lines longer than the wrap limit. Fenced code blocks and single-token
 * lines (long URLs, file paths) are exempt because they cannot be wrapped.
 */
const findOverflowingLines = (
  lines: readonly string[],
): readonly { line: number; length: number }[] => {
  const overflow: { line: number; length: number }[] = [];
  let inFence = false;

  lines.forEach((line, index) => {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (line.length <= BODY_WRAP_LIMIT) return;
    if (!line.trim().includes(" ")) return;

    overflow.push({ line: index + 1, length: line.length });
  });

  return overflow;
};

// ---------------------------------------------------------------------------
// Trailer Block Detection
// ---------------------------------------------------------------------------

/**
 * Detect trailer block boundaries in a commit message, enforcing that
 * a blank line separates body from trailers. Returns diagnostics for
 * trailer-blank-line violations.
 */
const findTrailerBlock = (
  lines: readonly string[],
): { trailerStart: number; diagnostics: readonly Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];

  // Scan backwards from end to find trailer block
  let trailerStart = lines.length;
  let foundBlankSeparator = false;

  for (let i = lines.length - 1; i >= 1; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      foundBlankSeparator = true;
      break;
    }
    const match = TRAILER_RE.exec(trimmed);
    if (match && KNOWN_TRAILER_KEYS.has(match[1].toLowerCase())) {
      trailerStart = i;
    } else {
      trailerStart = lines.length;
      break;
    }
  }

  // If we found trailers but no blank separator, that's an error
  if (trailerStart < lines.length && !foundBlankSeparator) {
    diagnostics.push({
      severity: "error",
      rule: "trailer-blank-line",
      message: "Trailers must be preceded by a blank line",
    });
  }

  return { trailerStart, diagnostics };
};

// ---------------------------------------------------------------------------
// Main Validation Pipeline
// ---------------------------------------------------------------------------

export const validate = (message: string): readonly Diagnostic[] => {
  const lines = message.trim().split("\n");
  if (lines.length === 0) {
    return [{
      severity: "error",
      rule: "non-empty",
      message: "Commit message is empty",
    }];
  }

  const header = lines[0];

  const subjectBlankLine: Diagnostic[] =
    lines.length > 1 && lines[1].trim() !== ""
      ? [{
        severity: "error",
        rule: "subject-blank-line",
        message: "Subject must be followed by a blank line",
      }]
      : [];

  const { trailerStart, diagnostics: trailerBlockDiagnostics } =
    findTrailerBlock(lines);

  const bodyLines = lines.slice(1, trailerStart);
  const body = bodyLines.join("\n").trim();
  const trailerLines = lines.slice(trailerStart);

  return [
    ...validateHeader(header),
    ...subjectBlankLine,
    ...validateBody(body, header),
    ...trailerBlockDiagnostics,
    ...validateTrailers(trailerLines),
  ];
};
