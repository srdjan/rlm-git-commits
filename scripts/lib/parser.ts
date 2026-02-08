/**
 * Pure parsing functions for structured git commits.
 *
 * Extracts structured data from git log output: header fields, body,
 * and typed trailers. All functions are pure and side-effect free.
 */

import {
  type ConventionalType,
  type IntentType,
  INTENT_TYPES,
  KNOWN_TRAILER_KEYS,
  type ParseError,
  Result,
  type StructuredCommit,
} from "../types.ts";

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

export const HEADER_RE =
  /^(feat|fix|refactor|perf|docs|test|build|ci|chore|revert)(?:\(([^)]+)\))?!?:\s+(.+)$/;

const TRAILER_RE = /^([A-Za-z][A-Za-z-]*)\s*:\s*(.+)$/;

// ---------------------------------------------------------------------------
// Trailer Parsing
// ---------------------------------------------------------------------------

export const isIntentType = (value: string): value is IntentType =>
  (INTENT_TYPES as readonly string[]).includes(value);

/**
 * Parse trailer lines into a map of key -> values.
 * Only recognizes keys from the KNOWN_TRAILER_KEYS set to prevent
 * false positives from body text containing colons.
 */
export const parseTrailers = (
  lines: readonly string[],
): Record<string, readonly string[]> => {
  const trailers: Record<string, string[]> = {};

  for (const line of lines) {
    const match = TRAILER_RE.exec(line.trim());
    if (match) {
      const [, key, value] = match;
      const normalizedKey = key.toLowerCase();
      if (!KNOWN_TRAILER_KEYS.has(normalizedKey)) continue;
      if (!trailers[normalizedKey]) {
        trailers[normalizedKey] = [];
      }
      trailers[normalizedKey].push(value.trim());
    }
  }

  return trailers;
};

export const parseContextJson = (
  raw: string,
): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Split the raw body portion of a git log entry into body text and
 * trailer lines. Trailers are recognized Key: Value lines in the
 * bottom portion of the message. Multiple trailer groups separated
 * by blank lines are merged (handles Co-Authored-By after structured
 * trailers with a blank line between them).
 */
export const splitHeaderBodyTrailers = (
  rawBody: string,
): { body: string; trailerLines: readonly string[] } => {
  const lines = rawBody.split("\n");

  // Scan backwards, collecting all recognized trailer lines.
  // Allow blank lines between trailer groups (e.g., structured trailers
  // followed by a blank line followed by Co-Authored-By).
  let trailerStart = lines.length;
  let i = lines.length - 1;

  // Skip trailing blank lines
  while (i >= 0 && lines[i].trim() === "") {
    i--;
  }

  while (i >= 0) {
    const trimmed = lines[i].trim();

    if (trimmed === "") {
      // Blank line - peek above to see if there are more trailers
      let j = i - 1;
      while (j >= 0 && lines[j].trim() === "") j--;
      if (j >= 0) {
        const above = TRAILER_RE.exec(lines[j].trim());
        if (above && KNOWN_TRAILER_KEYS.has(above[1].toLowerCase())) {
          // More trailers above - continue scanning
          i--;
          continue;
        }
      }
      // No trailers above the blank line - this is the body/trailer boundary
      break;
    }

    const match = TRAILER_RE.exec(trimmed);
    if (match && KNOWN_TRAILER_KEYS.has(match[1].toLowerCase())) {
      trailerStart = i;
      i--;
    } else {
      // Non-trailer, non-blank line - trailers haven't started
      trailerStart = lines.length;
      break;
    }
  }

  const body = lines
    .slice(0, trailerStart)
    .join("\n")
    .trim();
  const trailerLines = lines
    .slice(trailerStart)
    .map((l) => l.trim())
    .filter((l) => l !== "");

  return { body, trailerLines };
};

// ---------------------------------------------------------------------------
// Commit Block Parsing
// ---------------------------------------------------------------------------

export const parseCommitBlock = (
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
