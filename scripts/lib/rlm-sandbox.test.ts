import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";
import {
  createSandbox,
  sanitizeGitLogArgs,
  type SandboxEnv,
} from "./rlm-sandbox.ts";
import { Result } from "../types.ts";
import type { TrailerIndex } from "../types.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const makeIndex = (): TrailerIndex => ({
  version: 1,
  generated: "2025-01-01T00:00:00Z",
  headCommit: "abc123",
  commitCount: 3,
  byIntent: {
    "fix-defect": ["aaa", "bbb"],
    "enable-capability": ["ccc"],
  },
  byScope: {
    "auth": ["aaa", "ccc"],
    "auth/login": ["aaa"],
    "cache": ["bbb"],
  },
  bySession: { "s1": ["aaa", "bbb"] },
  withDecidedAgainst: ["bbb"],
  commits: {
    aaa: { hash: "aaa", date: "2025-01-03", subject: "fix auth bug", intent: "fix-defect", scope: ["auth", "auth/login"], session: "s1", decidedAgainst: [] },
    bbb: { hash: "bbb", date: "2025-01-02", subject: "fix cache ttl", intent: "fix-defect", scope: ["cache"], session: "s1", decidedAgainst: ["Redis sentinel"] },
    ccc: { hash: "ccc", date: "2025-01-01", subject: "add login page", intent: "enable-capability", scope: ["auth"], session: null, decidedAgainst: [] },
  },
});

const makeEnv = (): SandboxEnv => ({
  index: makeIndex(),
  workingMemory: null,
  scopeKeys: ["auth", "auth/login", "cache"],
});

const noopLlm = async () => Result.ok("llm response");
const noopGitLog = async () => Result.ok("git log output");

// ---------------------------------------------------------------------------
// sanitizeGitLogArgs (pure)
// ---------------------------------------------------------------------------

Deno.test("sanitizeGitLogArgs: allows valid flags", () => {
  const result = sanitizeGitLogArgs(["--format=%H %s", "-n", "10", "--no-merges"]);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value, ["--format=%H %s", "-n", "10", "--no-merges"]);
  }
});

Deno.test("sanitizeGitLogArgs: caps -n at 50", () => {
  const result = sanitizeGitLogArgs(["-n", "100"]);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value, ["-n", "50"]);
  }
});

Deno.test("sanitizeGitLogArgs: rejects pipe character", () => {
  const result = sanitizeGitLogArgs(["--format=%H", "|", "cat"]);
  assert(!result.ok);
});

Deno.test("sanitizeGitLogArgs: rejects semicolons", () => {
  const result = sanitizeGitLogArgs(["--format=%H; rm -rf /"]);
  assert(!result.ok);
});

Deno.test("sanitizeGitLogArgs: rejects disallowed flags", () => {
  const result = sanitizeGitLogArgs(["--exec", "bash"]);
  assert(!result.ok);
});

Deno.test("sanitizeGitLogArgs: rejects backticks", () => {
  const result = sanitizeGitLogArgs(["`whoami`"]);
  assert(!result.ok);
});

// ---------------------------------------------------------------------------
// Sandbox: basic execution
// ---------------------------------------------------------------------------

Deno.test("sandbox: executes simple code", async () => {
  const sandbox = createSandbox(makeEnv(), noopLlm, noopGitLog);

  const result = await sandbox.execute("console.log('hello');");
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value.stdout.trim(), "hello");
    assertEquals(result.value.error, null);
    assertEquals(result.value.done, false);
  }

  sandbox.terminate();
});

Deno.test("sandbox: query returns matching commits", async () => {
  const sandbox = createSandbox(makeEnv(), noopLlm, noopGitLog);

  const result = await sandbox.execute(`
    const commits = query({ scope: "auth" });
    console.log(JSON.stringify(commits.map(c => c.hash)));
  `);
  assert(result.ok);
  if (result.ok) {
    const hashes = JSON.parse(result.value.stdout.trim());
    assert(hashes.includes("aaa"));
    assert(hashes.includes("ccc"));
    assertEquals(result.value.error, null);
  }

  sandbox.terminate();
});

Deno.test("sandbox: done signal captured", async () => {
  const sandbox = createSandbox(makeEnv(), noopLlm, noopGitLog);

  const result = await sandbox.execute("done('The answer is 42');");
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value.done, true);
    assertEquals(result.value.doneAnswer, "The answer is 42");
  }

  sandbox.terminate();
});

Deno.test("sandbox: syntax error reported", async () => {
  const sandbox = createSandbox(makeEnv(), noopLlm, noopGitLog);

  const result = await sandbox.execute("const x = {;");
  assert(result.ok);
  if (result.ok) {
    assert(result.value.error !== null);
  }

  sandbox.terminate();
});

// ---------------------------------------------------------------------------
// Sandbox: callLlm round-trip
// ---------------------------------------------------------------------------

Deno.test("sandbox: callLlm round-trip", async () => {
  const mockLlm = async () => Result.ok("summary of auth changes");
  const sandbox = createSandbox(makeEnv(), mockLlm, noopGitLog);

  const result = await sandbox.execute(`
    const response = await callLlm([{role: "user", content: "summarize"}]);
    console.log(response);
  `);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value.stdout.trim(), "summary of auth changes");
    assertEquals(result.value.error, null);
  }

  sandbox.terminate();
});

// ---------------------------------------------------------------------------
// Sandbox: gitLog round-trip
// ---------------------------------------------------------------------------

Deno.test("sandbox: gitLog round-trip", async () => {
  const mockGitLog = async () => Result.ok("abc123 fix: auth bug");
  const sandbox = createSandbox(makeEnv(), noopLlm, mockGitLog);

  const result = await sandbox.execute(`
    const output = await gitLog(["--format=%H %s", "-n", "5"]);
    console.log(output);
  `);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value.stdout.trim(), "abc123 fix: auth bug");
  }

  sandbox.terminate();
});

// ---------------------------------------------------------------------------
// Sandbox: console.log capture
// ---------------------------------------------------------------------------

Deno.test("sandbox: multiple console.log captured", async () => {
  const sandbox = createSandbox(makeEnv(), noopLlm, noopGitLog);

  const result = await sandbox.execute(`
    console.log("line1");
    console.log("line2");
    console.log("line3");
  `);
  assert(result.ok);
  if (result.ok) {
    const lines = result.value.stdout.trim().split("\n");
    assertEquals(lines.length, 3);
    assertEquals(lines[0], "line1");
    assertEquals(lines[2], "line3");
  }

  sandbox.terminate();
});

// ---------------------------------------------------------------------------
// Sandbox: state persists across executions
// ---------------------------------------------------------------------------

Deno.test("sandbox: state persists across executions", async () => {
  const sandbox = createSandbox(makeEnv(), noopLlm, noopGitLog);

  await sandbox.execute("globalThis.myVar = 42;");
  const result = await sandbox.execute("console.log(globalThis.myVar);");
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value.stdout.trim(), "42");
  }

  sandbox.terminate();
});

// ---------------------------------------------------------------------------
// Sandbox: query with decidedAgainst
// ---------------------------------------------------------------------------

Deno.test("sandbox: query with decidedAgainst", async () => {
  const sandbox = createSandbox(makeEnv(), noopLlm, noopGitLog);

  const result = await sandbox.execute(`
    const commits = query({ decidedAgainst: "Redis" });
    console.log(JSON.stringify(commits.map(c => c.hash)));
  `);
  assert(result.ok);
  if (result.ok) {
    const hashes = JSON.parse(result.value.stdout.trim());
    assert(hashes.includes("bbb"));
  }

  sandbox.terminate();
});
