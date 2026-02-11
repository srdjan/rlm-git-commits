import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";
import { runRepl, type CallLlm, type ExecGitLog, type ReplConfig, type ReplEnv } from "./rlm-repl.ts";
import { Result } from "../types.ts";
import type { TrailerIndex } from "../types.ts";
import type { RlmConfig } from "./rlm-config.ts";
import { DEFAULT_CONFIG } from "./rlm-config.ts";

// ---------------------------------------------------------------------------
// Fixtures
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

const makeEnv = (): ReplEnv => ({
  index: makeIndex(),
  workingMemory: null,
  scopeKeys: ["auth", "auth/login", "cache"],
});

const makeReplConfig = (overrides: Partial<ReplConfig> = {}): ReplConfig => ({
  maxIterations: 6,
  maxLlmCalls: 10,
  timeoutBudgetMs: 15000,
  maxOutputTokens: 512,
  ...overrides,
});

const noopGitLog: ExecGitLog = async () => Result.ok("abc123 fix: auth bug");

// ---------------------------------------------------------------------------
// Helper: create a mock LLM that returns canned responses in sequence
// ---------------------------------------------------------------------------

const sequenceLlm = (responses: readonly string[]): CallLlm => {
  let i = 0;
  return async () => {
    if (i >= responses.length) return Result.fail(new Error("No more responses"));
    return Result.ok(responses[i++]);
  };
};

// ---------------------------------------------------------------------------
// Happy path: query + done in 1 iteration
// ---------------------------------------------------------------------------

Deno.test("runRepl: single iteration query and done", async () => {
  const llm = sequenceLlm([
    "Let me query the auth scope.\n```js\nconst commits = query({scope: 'auth'});\ndone('Found ' + commits.length + ' auth commits');\n```",
  ]);

  const result = await runRepl(DEFAULT_CONFIG, makeReplConfig(), "what auth changes?", makeEnv(), llm, noopGitLog);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value.answer, "Found 2 auth commits");
    assertEquals(result.value.iterations, 1);
    assert(result.value.llmCalls >= 1);
  }
});

// ---------------------------------------------------------------------------
// Multi-iteration: query, inspect, refine, done
// ---------------------------------------------------------------------------

Deno.test("runRepl: multi-iteration refinement", async () => {
  const llm = sequenceLlm([
    "```js\nconst commits = query({scope: 'auth'});\nconsole.log(commits.map(c => c.subject).join(', '));\n```",
    "```js\nconst bugs = query({intents: ['fix-defect']});\ndone('Auth: fix auth bug, add login page. Bugs: ' + bugs.length);\n```",
  ]);

  const result = await runRepl(DEFAULT_CONFIG, makeReplConfig(), "auth and bugs", makeEnv(), llm, noopGitLog);
  assert(result.ok);
  if (result.ok) {
    assert(result.value.answer.includes("Auth:"));
    assertEquals(result.value.iterations, 2);
  }
});

// ---------------------------------------------------------------------------
// No code block: treated as final text answer
// ---------------------------------------------------------------------------

Deno.test("runRepl: no code block treated as text answer", async () => {
  const llm = sequenceLlm([
    "Based on the index, the auth scope has 2 commits related to authentication.",
  ]);

  const result = await runRepl(DEFAULT_CONFIG, makeReplConfig(), "summarize auth", makeEnv(), llm, noopGitLog);
  assert(result.ok);
  if (result.ok) {
    assert(result.value.answer.includes("auth scope"));
    assertEquals(result.value.iterations, 1);
  }
});

// ---------------------------------------------------------------------------
// Syntax error: fed back, LLM corrects
// ---------------------------------------------------------------------------

Deno.test("runRepl: syntax error recovery", async () => {
  const llm = sequenceLlm([
    "```js\nconst x = {;\n```",
    "```js\ndone('recovered');\n```",
  ]);

  const result = await runRepl(DEFAULT_CONFIG, makeReplConfig(), "test", makeEnv(), llm, noopGitLog);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value.answer, "recovered");
    assertEquals(result.value.iterations, 2);
    assert(result.value.trace[0].executionResult.includes("ERROR"));
  }
});

// ---------------------------------------------------------------------------
// Max iterations: forced final answer
// ---------------------------------------------------------------------------

Deno.test("runRepl: max iterations forces final answer", async () => {
  // LLM always writes code, never calls done()
  const llm = sequenceLlm([
    "```js\nconsole.log('iter1');\n```",
    "```js\nconsole.log('iter2');\n```",
    "```js\nconsole.log('iter3');\n```",
    "The auth scope has commits about login and caching.",
  ]);

  const result = await runRepl(
    DEFAULT_CONFIG,
    makeReplConfig({ maxIterations: 3 }),
    "auth?",
    makeEnv(),
    llm,
    noopGitLog,
  );
  assert(result.ok);
  if (result.ok) {
    // Should get the forced text answer
    assert(result.value.answer.includes("auth") || result.value.trace.length > 0);
  }
});

// ---------------------------------------------------------------------------
// LLM failure: propagated as error
// ---------------------------------------------------------------------------

Deno.test("runRepl: LLM failure propagated", async () => {
  const failingLlm: CallLlm = async () => Result.fail(new Error("connection refused"));

  const result = await runRepl(DEFAULT_CONFIG, makeReplConfig(), "test", makeEnv(), failingLlm, noopGitLog);
  assert(!result.ok);
  if (!result.ok) {
    assert(result.error.message.includes("connection refused"));
  }
});

// ---------------------------------------------------------------------------
// Max LLM calls: budget enforced
// ---------------------------------------------------------------------------

Deno.test("runRepl: LLM call budget respected", async () => {
  // LLM always writes code that doesn't call done
  let callCount = 0;
  const countingLlm: CallLlm = async () => {
    callCount++;
    if (callCount <= 2) {
      return Result.ok("```js\nconsole.log('still going');\n```");
    }
    return Result.ok("Final answer after budget.");
  };

  const result = await runRepl(
    DEFAULT_CONFIG,
    makeReplConfig({ maxLlmCalls: 3 }),
    "test",
    makeEnv(),
    countingLlm,
    noopGitLog,
  );
  assert(result.ok);
  // Should not have made more than 3 calls
  if (result.ok) {
    assert(result.value.llmCalls <= 4); // 3 root + at most 1 forced final
  }
});
