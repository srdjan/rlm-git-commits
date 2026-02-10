import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { extractPromptSignals } from "./prompt-analyzer.ts";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const scopeKeys = [
  "auth",
  "auth/login",
  "auth/registration",
  "auth/registration/flow",
  "oauth/provider",
  "search/vector",
  "hooks",
  "hooks/context",
  "misc",
];

// ---------------------------------------------------------------------------
// extractPromptSignals
// ---------------------------------------------------------------------------

Deno.test("extractPromptSignals: fix auth login bug", () => {
  const signals = extractPromptSignals("fix the auth login bug", scopeKeys);
  assertEquals(signals.scopeHints.includes("auth"), true);
  assertEquals(signals.intentHints.includes("fix-defect"), true);
  // "login" is not a direct scope key, and "bug" maps to intent
  // "the" is a stop word - should be filtered
  assertEquals(signals.keywords.includes("the"), false);
  // "login" should be a keyword since "auth/login" matches on "auth" not "login"
  assertEquals(signals.keywords.includes("login"), true);
});

Deno.test("extractPromptSignals: empty prompt produces empty signals", () => {
  const signals = extractPromptSignals("", scopeKeys);
  assertEquals(signals.scopeHints.length, 0);
  assertEquals(signals.intentHints.length, 0);
  assertEquals(signals.keywords.length, 0);
});

Deno.test("extractPromptSignals: whitespace-only prompt produces empty signals", () => {
  const signals = extractPromptSignals("   ", scopeKeys);
  assertEquals(signals.scopeHints.length, 0);
  assertEquals(signals.intentHints.length, 0);
  assertEquals(signals.keywords.length, 0);
});

Deno.test("extractPromptSignals: case insensitive matching", () => {
  const signals = extractPromptSignals("Fix the AUTH bug", scopeKeys);
  assertEquals(signals.scopeHints.includes("auth"), true);
  assertEquals(signals.intentHints.includes("fix-defect"), true);
});

Deno.test("extractPromptSignals: stop words filtered from keywords", () => {
  const signals = extractPromptSignals(
    "the is are was in on at to for of with by",
    scopeKeys,
  );
  assertEquals(signals.keywords.length, 0);
});

Deno.test("extractPromptSignals: multiple intents deduplicated", () => {
  // "fix" and "bug" both map to fix-defect
  const signals = extractPromptSignals("fix the bug", scopeKeys);
  assertEquals(signals.intentHints.length, 1);
  assertEquals(signals.intentHints[0], "fix-defect");
});

Deno.test("extractPromptSignals: refactor maps to restructure", () => {
  const signals = extractPromptSignals("refactor auth module", scopeKeys);
  assertEquals(signals.intentHints.includes("restructure"), true);
  assertEquals(signals.scopeHints.includes("auth"), true);
});

Deno.test("extractPromptSignals: no scope keys means no scope hints", () => {
  const signals = extractPromptSignals("fix the auth login bug", []);
  assertEquals(signals.scopeHints.length, 0);
  assertEquals(signals.intentHints.includes("fix-defect"), true);
  assertEquals(signals.keywords.includes("auth"), true);
  assertEquals(signals.keywords.includes("login"), true);
});

Deno.test("extractPromptSignals: hooks scope matches", () => {
  const signals = extractPromptSignals("update the hooks context", scopeKeys);
  assertEquals(signals.scopeHints.includes("hooks"), true);
});

Deno.test("extractPromptSignals: document intent", () => {
  const signals = extractPromptSignals("add docs for the readme", scopeKeys);
  assertEquals(signals.intentHints.includes("document"), true);
  assertEquals(signals.intentHints.includes("enable-capability"), true);
});

Deno.test("extractPromptSignals: explore intent", () => {
  const signals = extractPromptSignals(
    "investigate search vector performance",
    scopeKeys,
  );
  assertEquals(signals.intentHints.includes("explore"), true);
  // "search" matches as prefix of "search/vector" via scopeMatches
  assertEquals(signals.scopeHints.includes("search"), true);
});

Deno.test("extractPromptSignals: keywords exclude consumed tokens", () => {
  // "auth" consumed by scope, "fix" consumed by intent, "login" remains
  const signals = extractPromptSignals("fix auth login", scopeKeys);
  assertEquals(signals.keywords.includes("auth"), false);
  assertEquals(signals.keywords.includes("fix"), false);
  assertEquals(signals.keywords.includes("login"), true);
});

Deno.test("extractPromptSignals: duplicate keywords deduplicated", () => {
  const signals = extractPromptSignals("login login login", scopeKeys);
  assertEquals(signals.keywords.length, 1);
  assertEquals(signals.keywords[0], "login");
});

Deno.test("extractPromptSignals: punctuation stripped from tokens", () => {
  const signals = extractPromptSignals("fix: auth! (login)", scopeKeys);
  assertEquals(signals.scopeHints.includes("auth"), true);
  assertEquals(signals.intentHints.includes("fix-defect"), true);
});
