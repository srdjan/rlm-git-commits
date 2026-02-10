import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { parseQueryCommand } from "./command-parser.ts";

// ---------------------------------------------------------------------------
// parseQueryCommand
// ---------------------------------------------------------------------------

Deno.test("parseQueryCommand: returns null for non-query commands", () => {
  assertEquals(parseQueryCommand("npm test"), null);
  assertEquals(parseQueryCommand("git log --oneline -10"), null);
  assertEquals(parseQueryCommand("deno test"), null);
  assertEquals(parseQueryCommand("ls -la"), null);
});

Deno.test("parseQueryCommand: bare deno task parse", () => {
  const result = parseQueryCommand("deno task parse");
  assertEquals(result !== null, true);
  assertEquals(result?.scope, null);
  assertEquals(result?.intents.length, 0);
  assertEquals(result?.session, null);
  assertEquals(result?.decidedAgainst, null);
  assertEquals(result?.decisionsOnly, false);
});

Deno.test("parseQueryCommand: with scope flag", () => {
  const result = parseQueryCommand("deno task parse -- --scope=auth/login");
  assertEquals(result?.scope, "auth/login");
});

Deno.test("parseQueryCommand: with intent flag", () => {
  const result = parseQueryCommand("deno task parse -- --intent=fix-defect");
  assertEquals(result?.intents.length, 1);
  assertEquals(result?.intents[0], "fix-defect");
});

Deno.test("parseQueryCommand: with multiple intent flags", () => {
  const result = parseQueryCommand(
    "deno task parse -- --intent=fix-defect --intent=resolve-blocker",
  );
  assertEquals(result?.intents.length, 2);
  assertEquals(result?.intents.includes("fix-defect"), true);
  assertEquals(result?.intents.includes("resolve-blocker"), true);
});

Deno.test("parseQueryCommand: with session flag", () => {
  const result = parseQueryCommand(
    "deno task parse -- --session=2026-02-10/rlm",
  );
  assertEquals(result?.session, "2026-02-10/rlm");
});

Deno.test("parseQueryCommand: with decided-against flag", () => {
  const result = parseQueryCommand(
    "deno task parse -- --decided-against=redis",
  );
  assertEquals(result?.decidedAgainst, "redis");
});

Deno.test("parseQueryCommand: with decisions-only flag", () => {
  const result = parseQueryCommand("deno task parse -- --decisions-only");
  assertEquals(result?.decisionsOnly, true);
});

Deno.test("parseQueryCommand: combined scope and intent", () => {
  const result = parseQueryCommand(
    "deno task parse -- --scope=auth --intent=fix-defect --with-body --limit=5",
  );
  assertEquals(result?.scope, "auth");
  assertEquals(result?.intents.length, 1);
  assertEquals(result?.intents[0], "fix-defect");
});

Deno.test("parseQueryCommand: invalid intent values are filtered", () => {
  const result = parseQueryCommand(
    "deno task parse -- --intent=not-a-real-intent",
  );
  assertEquals(result?.intents.length, 0);
});
