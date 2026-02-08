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
// Header Validation
// ---------------------------------------------------------------------------

export const validateHeader = (header: string): readonly Diagnostic[] => {
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
      message: `Subject may not be imperative mood: "${firstWord}" - use "add" not "added"/"adding"`,
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
  }

  return diagnostics;
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

  const { trailerStart, diagnostics: trailerBlockDiagnostics } =
    findTrailerBlock(lines);

  const bodyLines = lines.slice(1, trailerStart);
  const body = bodyLines.join("\n").trim();
  const trailerLines = lines.slice(trailerStart);

  return [
    ...validateHeader(header),
    ...validateBody(body, header),
    ...trailerBlockDiagnostics,
    ...validateTrailers(trailerLines),
  ];
};
