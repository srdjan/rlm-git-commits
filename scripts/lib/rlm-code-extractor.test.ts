import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { extractCodeBlock } from "./rlm-code-extractor.ts";

// ---------------------------------------------------------------------------
// Fenced code blocks
// ---------------------------------------------------------------------------

Deno.test("extractCodeBlock: js fence", () => {
  const input = "Here is the code:\n```js\nconsole.log(1);\n```\nDone.";
  assertEquals(extractCodeBlock(input), "console.log(1);");
});

Deno.test("extractCodeBlock: javascript fence", () => {
  const input = "```javascript\nconst x = 42;\n```";
  assertEquals(extractCodeBlock(input), "const x = 42;");
});

Deno.test("extractCodeBlock: bare fence", () => {
  const input = "```\nquery({scope: 'auth'});\n```";
  assertEquals(extractCodeBlock(input), "query({scope: 'auth'});");
});

Deno.test("extractCodeBlock: missing closing fence treats rest as code", () => {
  const input = "```js\nconst y = 1;\nconsole.log(y);";
  assertEquals(extractCodeBlock(input), "const y = 1;\nconsole.log(y);");
});

Deno.test("extractCodeBlock: no fence returns null", () => {
  const input = "The relevant context is about authentication and caching.";
  assertEquals(extractCodeBlock(input), null);
});

Deno.test("extractCodeBlock: empty code block returns null", () => {
  const input = "```js\n   \n```";
  assertEquals(extractCodeBlock(input), null);
});

Deno.test("extractCodeBlock: multiline code preserved", () => {
  const input = "```js\nconst a = 1;\nconst b = 2;\ndone(a + b);\n```";
  assertEquals(extractCodeBlock(input), "const a = 1;\nconst b = 2;\ndone(a + b);");
});

Deno.test("extractCodeBlock: preamble and postamble stripped", () => {
  const input = "I'll query the index first.\n```js\nquery({scope:'auth'});\n```\nLet me analyze.";
  assertEquals(extractCodeBlock(input), "query({scope:'auth'});");
});

Deno.test("extractCodeBlock: only first block extracted", () => {
  const input = "```js\nfirst();\n```\nThen:\n```js\nsecond();\n```";
  assertEquals(extractCodeBlock(input), "first();");
});
