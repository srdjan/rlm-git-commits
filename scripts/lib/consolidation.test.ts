import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";
import {
  collectScopes,
  decisionsToTrailers,
  formatSessionSummary,
  formatTrailerHints,
  groupByTag,
} from "./consolidation.ts";
import type { WorkingMemory, WorkingMemoryEntry } from "./working-memory.ts";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const makeEntry = (
  overrides: Partial<WorkingMemoryEntry> = {},
): WorkingMemoryEntry => ({
  timestamp: "2026-02-10T10:00:00Z",
  tag: "finding",
  scope: [],
  text: "test entry",
  source: null,
  ...overrides,
});

const makeMemory = (
  entries: readonly WorkingMemoryEntry[],
): WorkingMemory => ({
  version: 1,
  sessionId: "2026-02-10/test",
  created: "2026-02-10T10:00:00Z",
  updated: "2026-02-10T10:05:00Z",
  entries,
});

// ---------------------------------------------------------------------------
// groupByTag
// ---------------------------------------------------------------------------

Deno.test("groupByTag: groups entries by their tag", () => {
  const entries = [
    makeEntry({ tag: "finding", text: "f1" }),
    makeEntry({ tag: "decision", text: "d1" }),
    makeEntry({ tag: "finding", text: "f2" }),
    makeEntry({ tag: "todo", text: "t1" }),
  ];
  const grouped = groupByTag(entries);
  assertEquals(grouped.get("finding")?.length, 2);
  assertEquals(grouped.get("decision")?.length, 1);
  assertEquals(grouped.get("todo")?.length, 1);
  assertEquals(grouped.get("hypothesis"), undefined);
});

Deno.test("groupByTag: empty entries returns empty map", () => {
  const grouped = groupByTag([]);
  assertEquals(grouped.size, 0);
});

// ---------------------------------------------------------------------------
// collectScopes
// ---------------------------------------------------------------------------

Deno.test("collectScopes: collects unique scopes sorted", () => {
  const entries = [
    makeEntry({ scope: ["auth/login", "auth"] }),
    makeEntry({ scope: ["search/vector"] }),
    makeEntry({ scope: ["auth"] }),
  ];
  const scopes = collectScopes(entries);
  assertEquals(scopes, ["auth", "auth/login", "search/vector"]);
});

Deno.test("collectScopes: empty entries returns empty array", () => {
  assertEquals(collectScopes([]), []);
});

// ---------------------------------------------------------------------------
// decisionsToTrailers
// ---------------------------------------------------------------------------

Deno.test("decisionsToTrailers: extracts decided-against from decision entries", () => {
  const entries = [
    makeEntry({ tag: "decision", text: "Use JWT over session cookies", scope: ["auth"] }),
    makeEntry({ tag: "finding", text: "JWT has sliding window" }),
    makeEntry({ tag: "decision", text: "Redis rejected for pub/sub", scope: ["cache"] }),
  ];
  const hints = decisionsToTrailers(entries);
  assertEquals(hints.decidedAgainst.length, 2);
  assertEquals(hints.decidedAgainst[0], "Use JWT over session cookies");
  assertEquals(hints.decidedAgainst[1], "Redis rejected for pub/sub");
  assertEquals(hints.scopes, ["auth", "cache"]);
});

Deno.test("decisionsToTrailers: no decision entries produces empty trailers", () => {
  const entries = [
    makeEntry({ tag: "finding", text: "found something" }),
  ];
  const hints = decisionsToTrailers(entries);
  assertEquals(hints.decidedAgainst.length, 0);
});

// ---------------------------------------------------------------------------
// formatSessionSummary
// ---------------------------------------------------------------------------

Deno.test("formatSessionSummary: includes all sections", () => {
  const entries = [
    makeEntry({ tag: "decision", text: "Use refresh tokens", scope: ["auth"] }),
    makeEntry({ tag: "finding", text: "JWT sliding window", scope: ["auth"] }),
    makeEntry({ tag: "hypothesis", text: "Token refresh may cause race condition" }),
    makeEntry({ tag: "context", text: "User has OAuth2 setup" }),
    makeEntry({ tag: "todo", text: "Add token refresh endpoint" }),
  ];
  const memory = makeMemory(entries);
  const summary = formatSessionSummary(memory);

  assert(summary.includes("# Session Summary: 2026-02-10/test"));
  assert(summary.includes("Entries: 5"));
  assert(summary.includes("Scopes: auth"));
  assert(summary.includes("## Decisions"));
  assert(summary.includes("## Findings"));
  assert(summary.includes("## Hypotheses"));
  assert(summary.includes("## Context"));
  assert(summary.includes("## TODOs"));
  assert(summary.includes("Use refresh tokens [auth]"));
  assert(summary.includes("JWT sliding window [auth]"));
});

Deno.test("formatSessionSummary: includes source references", () => {
  const entries = [
    makeEntry({ tag: "finding", text: "found in commit", source: "abc1234" }),
  ];
  const summary = formatSessionSummary(makeMemory(entries));
  assert(summary.includes("(source: abc1234)"));
});

Deno.test("formatSessionSummary: empty entries still has header", () => {
  const summary = formatSessionSummary(makeMemory([]));
  assert(summary.includes("# Session Summary"));
  assert(summary.includes("Entries: 0"));
});

// ---------------------------------------------------------------------------
// formatTrailerHints
// ---------------------------------------------------------------------------

Deno.test("formatTrailerHints: formats scope and decided-against", () => {
  const output = formatTrailerHints({
    scopes: ["auth", "auth/login"],
    decidedAgainst: ["session cookies (stateful)", "Redis for caching"],
  });
  assert(output.includes("Scope: auth, auth/login"));
  assert(output.includes("Decided-Against: session cookies (stateful)"));
  assert(output.includes("Decided-Against: Redis for caching"));
});

Deno.test("formatTrailerHints: empty hints returns empty string", () => {
  assertEquals(formatTrailerHints({ scopes: [], decidedAgainst: [] }), "");
});
