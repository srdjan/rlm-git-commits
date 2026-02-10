import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";
import {
  addEntry,
  clearWorkingMemory,
  formatWorkingMemory,
  getWorkingMemoryPath,
  loadWorkingMemory,
  type WorkingMemory,
  type WorkingMemoryEntry,
} from "./working-memory.ts";

// ---------------------------------------------------------------------------
// formatWorkingMemory (pure, no I/O)
// ---------------------------------------------------------------------------

const makeMemory = (
  entries: readonly WorkingMemoryEntry[],
  sessionId = "2026-02-10/test",
): WorkingMemory => ({
  version: 1,
  sessionId,
  created: "2026-02-10T10:00:00Z",
  updated: "2026-02-10T10:05:00Z",
  entries,
});

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

Deno.test("formatWorkingMemory: empty entries returns empty string", () => {
  const memory = makeMemory([]);
  assertEquals(formatWorkingMemory(memory), "");
});

Deno.test("formatWorkingMemory: single finding entry", () => {
  const memory = makeMemory([
    makeEntry({ tag: "finding", text: "JWT uses sliding window" }),
  ]);
  const output = formatWorkingMemory(memory);
  assert(output.includes("[finding]"));
  assert(output.includes("JWT uses sliding window"));
  assert(output.includes('session="2026-02-10/test"'));
});

Deno.test("formatWorkingMemory: entry with scope", () => {
  const memory = makeMemory([
    makeEntry({ scope: ["auth", "auth/login"], text: "token refresh needed" }),
  ]);
  const output = formatWorkingMemory(memory);
  assert(output.includes("[auth, auth/login]"));
});

Deno.test("formatWorkingMemory: entry with source", () => {
  const memory = makeMemory([
    makeEntry({ text: "found in commit", source: "abc1234" }),
  ]);
  const output = formatWorkingMemory(memory);
  assert(output.includes("(abc1234)"));
});

Deno.test("formatWorkingMemory: respects limit, takes most recent", () => {
  const entries = Array.from({ length: 30 }, (_, i) =>
    makeEntry({ text: `entry ${i}` })
  );
  const memory = makeMemory(entries);
  const output = formatWorkingMemory(memory, 5);
  assert(output.includes("entry 25"));
  assert(output.includes("entry 29"));
  assert(!output.includes("entry 0"));
  assert(output.includes('entries="5"'));
});

Deno.test("formatWorkingMemory: all tag types render", () => {
  const entries: WorkingMemoryEntry[] = [
    makeEntry({ tag: "finding", text: "f1" }),
    makeEntry({ tag: "hypothesis", text: "h1" }),
    makeEntry({ tag: "decision", text: "d1" }),
    makeEntry({ tag: "context", text: "c1" }),
    makeEntry({ tag: "todo", text: "t1" }),
  ];
  const memory = makeMemory(entries);
  const output = formatWorkingMemory(memory);
  assert(output.includes("[finding]"));
  assert(output.includes("[hypothesis]"));
  assert(output.includes("[decision]"));
  assert(output.includes("[context]"));
  assert(output.includes("[todo]"));
});

// ---------------------------------------------------------------------------
// Round-trip: addEntry, loadWorkingMemory, clearWorkingMemory
// These tests use real filesystem I/O via .git/info/working-memory.json
// ---------------------------------------------------------------------------

Deno.test("working memory: round-trip add, load, clear", async () => {
  const sessionId = "2026-02-10/round-trip-test";

  // Clear any prior state
  await clearWorkingMemory();

  // Load from empty: should be null
  const loadEmpty = await loadWorkingMemory(sessionId);
  assert(loadEmpty.ok);
  assertEquals(loadEmpty.ok ? loadEmpty.value : "fail", null);

  // Add first entry
  const addResult = await addEntry(sessionId, {
    tag: "finding",
    scope: ["auth"],
    text: "JWT uses sliding window",
    source: "abc1234",
  });
  assert(addResult.ok);
  if (addResult.ok) {
    assertEquals(addResult.value.entries.length, 1);
    assertEquals(addResult.value.sessionId, sessionId);
  }

  // Add second entry
  const addResult2 = await addEntry(sessionId, {
    tag: "decision",
    scope: ["auth/login"],
    text: "Use refresh tokens",
    source: null,
  });
  assert(addResult2.ok);
  if (addResult2.ok) {
    assertEquals(addResult2.value.entries.length, 2);
  }

  // Load: should have 2 entries
  const loadResult = await loadWorkingMemory(sessionId);
  assert(loadResult.ok);
  if (loadResult.ok && loadResult.value) {
    assertEquals(loadResult.value.entries.length, 2);
    assertEquals(loadResult.value.entries[0].tag, "finding");
    assertEquals(loadResult.value.entries[1].tag, "decision");
  }

  // Load with wrong session: should be null
  const wrongSession = await loadWorkingMemory("wrong-session");
  assert(wrongSession.ok);
  assertEquals(wrongSession.ok ? wrongSession.value : "fail", null);

  // Clear
  const clearResult = await clearWorkingMemory();
  assert(clearResult.ok);

  // Load after clear: should be null
  const loadAfterClear = await loadWorkingMemory(sessionId);
  assert(loadAfterClear.ok);
  assertEquals(loadAfterClear.ok ? loadAfterClear.value : "fail", null);
});

Deno.test("working memory: clear when file does not exist is ok", async () => {
  // Ensure file doesn't exist
  await clearWorkingMemory();
  // Clear again: should not throw
  const result = await clearWorkingMemory();
  assert(result.ok);
});

Deno.test("working memory: getWorkingMemoryPath returns .git/info path", async () => {
  const result = await getWorkingMemoryPath();
  assert(result.ok);
  if (result.ok) {
    assert(result.value.endsWith("/info/working-memory.json"));
  }
});
