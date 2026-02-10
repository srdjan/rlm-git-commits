/**
 * Pure functions for consolidating working memory into durable artifacts.
 *
 * Converts working memory entries into:
 *   - A Markdown session summary
 *   - Commit trailer hints (Decided-Against, Scope suggestions)
 *
 * Used by the Stop hook to write-back to the environment.
 */

import type { WorkingMemory, WorkingMemoryEntry, EntryTag } from "./working-memory.ts";

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export const groupByTag = (
  entries: readonly WorkingMemoryEntry[],
): ReadonlyMap<EntryTag, readonly WorkingMemoryEntry[]> => {
  const groups = new Map<EntryTag, WorkingMemoryEntry[]>();

  for (const entry of entries) {
    const existing = groups.get(entry.tag);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(entry.tag, [entry]);
    }
  }

  return groups;
};

// ---------------------------------------------------------------------------
// Scope Collection
// ---------------------------------------------------------------------------

export const collectScopes = (
  entries: readonly WorkingMemoryEntry[],
): readonly string[] => {
  const scopes = new Set<string>();
  for (const entry of entries) {
    for (const scope of entry.scope) {
      scopes.add(scope);
    }
  }
  return [...scopes].sort();
};

// ---------------------------------------------------------------------------
// Trailer Hints
// ---------------------------------------------------------------------------

export interface TrailerHints {
  readonly decidedAgainst: readonly string[];
  readonly scopes: readonly string[];
}

export const decisionsToTrailers = (
  entries: readonly WorkingMemoryEntry[],
): TrailerHints => {
  const decidedAgainst: string[] = [];

  // Only "decision" tagged entries with rejection/exclusion semantics
  const decisions = entries.filter((e) => e.tag === "decision");
  for (const d of decisions) {
    decidedAgainst.push(d.text);
  }

  const scopes = collectScopes(entries);

  return { decidedAgainst, scopes };
};

// ---------------------------------------------------------------------------
// Session Summary
// ---------------------------------------------------------------------------

const TAG_HEADINGS: Record<EntryTag, string> = {
  finding: "Findings",
  hypothesis: "Hypotheses",
  decision: "Decisions",
  context: "Context",
  todo: "TODOs",
};

const TAG_ORDER: readonly EntryTag[] = [
  "decision",
  "finding",
  "hypothesis",
  "context",
  "todo",
];

export const formatSessionSummary = (memory: WorkingMemory): string => {
  const lines: string[] = [];
  const grouped = groupByTag(memory.entries);
  const scopes = collectScopes(memory.entries);

  // Header
  lines.push(`# Session Summary: ${memory.sessionId}`);
  lines.push("");
  lines.push(`Created: ${memory.created}`);
  lines.push(`Updated: ${memory.updated}`);
  lines.push(`Entries: ${memory.entries.length}`);

  if (scopes.length > 0) {
    lines.push(`Scopes: ${scopes.join(", ")}`);
  }

  // Sections by tag
  for (const tag of TAG_ORDER) {
    const entries = grouped.get(tag);
    if (!entries || entries.length === 0) continue;

    lines.push("");
    lines.push(`## ${TAG_HEADINGS[tag]}`);
    lines.push("");

    for (const entry of entries) {
      const scopeLabel = entry.scope.length > 0
        ? ` [${entry.scope.join(", ")}]`
        : "";
      const sourceLabel = entry.source ? ` (source: ${entry.source})` : "";
      lines.push(`- ${entry.text}${scopeLabel}${sourceLabel}`);
    }
  }

  lines.push("");
  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// Trailer Hints Formatting
// ---------------------------------------------------------------------------

export const formatTrailerHints = (hints: TrailerHints): string => {
  const lines: string[] = [];

  if (hints.scopes.length > 0) {
    lines.push(`Scope: ${hints.scopes.join(", ")}`);
  }

  for (const da of hints.decidedAgainst) {
    lines.push(`Decided-Against: ${da}`);
  }

  return lines.join("\n");
};
