import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";
import { buildReplSystemPrompt } from "./rlm-system-prompt.ts";
import { INTENT_TYPES } from "../types.ts";

const makeOpts = (overrides: Record<string, unknown> = {}) => ({
  scopeKeySample: ["auth", "cache", "auth/login", "api/v2"],
  intentTypes: [...INTENT_TYPES],
  commitCount: 42,
  hasWorkingMemory: false,
  budget: { maxIterations: 6, maxLlmCalls: 10 },
  ...overrides,
});

Deno.test("buildReplSystemPrompt: contains all API function names", () => {
  const prompt = buildReplSystemPrompt(makeOpts());
  assert(prompt.includes("query("));
  assert(prompt.includes("callLlm("));
  assert(prompt.includes("gitLog("));
  assert(prompt.includes("done("));
  assert(prompt.includes("console.log"));
});

Deno.test("buildReplSystemPrompt: contains intent types", () => {
  const prompt = buildReplSystemPrompt(makeOpts());
  for (const intent of INTENT_TYPES) {
    assert(prompt.includes(intent), `missing intent: ${intent}`);
  }
});

Deno.test("buildReplSystemPrompt: contains scope sample", () => {
  const prompt = buildReplSystemPrompt(makeOpts());
  assert(prompt.includes("auth"));
  assert(prompt.includes("cache"));
  assert(prompt.includes("auth/login"));
});

Deno.test("buildReplSystemPrompt: reflects budget", () => {
  const prompt = buildReplSystemPrompt(makeOpts({
    budget: { maxIterations: 3, maxLlmCalls: 5 },
  }));
  assert(prompt.includes("3 iterations"));
  assert(prompt.includes("5 total LLM calls"));
});

Deno.test("buildReplSystemPrompt: reflects working memory presence", () => {
  const withWm = buildReplSystemPrompt(makeOpts({ hasWorkingMemory: true }));
  assert(withWm.includes("entries from the current session"));

  const withoutWm = buildReplSystemPrompt(makeOpts({ hasWorkingMemory: false }));
  assert(withoutWm.includes("workingMemory: null"));
});

Deno.test("buildReplSystemPrompt: caps scope sample at 20", () => {
  const manyScopes = Array.from({ length: 30 }, (_, i) => `scope-${i}`);
  const prompt = buildReplSystemPrompt(makeOpts({ scopeKeySample: manyScopes }));
  assert(prompt.includes("scope-19"));
  assert(!prompt.includes("scope-20"));
});

Deno.test("buildReplSystemPrompt: does not leak raw index data", () => {
  const prompt = buildReplSystemPrompt(makeOpts());
  // Should describe the shape, not contain actual commit hashes
  assert(!prompt.includes("aaa111"));
  assert(prompt.includes("TrailerIndex"));
});
