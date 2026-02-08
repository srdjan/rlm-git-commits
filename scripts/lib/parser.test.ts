import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";
import {
  isIntentType,
  parseCommitBlock,
  parseTrailers,
  splitHeaderBodyTrailers,
} from "./parser.ts";

// ---------------------------------------------------------------------------
// parseTrailers
// ---------------------------------------------------------------------------

Deno.test("parseTrailers: extracts known trailer keys", () => {
  const lines = [
    "Intent: enable-capability",
    "Scope: auth/registration, identity/agent",
    "Decided-Against: OAuth2 client credentials (no hardware binding)",
    "Session: 2025-02-08/passkey-lib",
  ];
  const result = parseTrailers(lines);

  assertEquals(result["intent"], ["enable-capability"]);
  assertEquals(result["scope"], ["auth/registration, identity/agent"]);
  assertEquals(result["decided-against"], [
    "OAuth2 client credentials (no hardware binding)",
  ]);
  assertEquals(result["session"], ["2025-02-08/passkey-lib"]);
});

Deno.test("parseTrailers: ignores unknown trailer keys", () => {
  const lines = [
    "WEBHOOK_URL: https://example.com",
    "Intent: fix-defect",
    "Scope: api/webhooks",
  ];
  const result = parseTrailers(lines);

  assertEquals(result["webhook_url"], undefined);
  assertEquals(result["intent"], ["fix-defect"]);
  assertEquals(result["scope"], ["api/webhooks"]);
});

Deno.test("parseTrailers: handles multiple Decided-Against entries", () => {
  const lines = [
    "Decided-Against: Redis pub/sub (no persistence guarantee)",
    "Decided-Against: Kafka (operational overhead)",
  ];
  const result = parseTrailers(lines);

  assertEquals(result["decided-against"], [
    "Redis pub/sub (no persistence guarantee)",
    "Kafka (operational overhead)",
  ]);
});

Deno.test("parseTrailers: handles standard git trailers", () => {
  const lines = [
    "Intent: fix-defect",
    "Scope: auth/login",
    "Signed-off-by: Alice <alice@example.com>",
    "Co-authored-by: Bob <bob@example.com>",
  ];
  const result = parseTrailers(lines);

  assertEquals(result["signed-off-by"], ["Alice <alice@example.com>"]);
  assertEquals(result["co-authored-by"], ["Bob <bob@example.com>"]);
});

Deno.test("parseTrailers: normalizes keys to lowercase", () => {
  const lines = ["Intent: explore", "SCOPE: search/vector"];
  const result = parseTrailers(lines);

  assertEquals(result["intent"], ["explore"]);
  assertEquals(result["scope"], ["search/vector"]);
});

// ---------------------------------------------------------------------------
// splitHeaderBodyTrailers
// ---------------------------------------------------------------------------

Deno.test("splitHeaderBodyTrailers: separates body from trailers at blank line", () => {
  const rawBody = `
Implement WebAuthn registration flow.

Intent: enable-capability
Scope: auth/registration`;

  const { body, trailerLines } = splitHeaderBodyTrailers(rawBody);

  assertEquals(body, "Implement WebAuthn registration flow.");
  assert(trailerLines.some((l) => l.includes("Intent:")));
  assert(trailerLines.some((l) => l.includes("Scope:")));
});

Deno.test("splitHeaderBodyTrailers: URL in body is not treated as trailer", () => {
  const rawBody = `
Configure via environment variable WEBHOOK_URL: https://example.com

Intent: enable-capability
Scope: api/webhooks`;

  const { body, trailerLines } = splitHeaderBodyTrailers(rawBody);

  assert(body.includes("WEBHOOK_URL: https://example.com"));
  assertEquals(trailerLines.length, 2);
  assert(trailerLines.some((l) => l.includes("Intent:")));
  assert(trailerLines.some((l) => l.includes("Scope:")));
});

Deno.test("splitHeaderBodyTrailers: body only when no trailers present", () => {
  const rawBody = `
Just a simple body with no trailers.
This is a second line.`;

  const { body, trailerLines } = splitHeaderBodyTrailers(rawBody);

  assert(body.includes("Just a simple body"));
  assertEquals(trailerLines.length, 0);
});

Deno.test("splitHeaderBodyTrailers: empty body with trailers", () => {
  const rawBody = `
Intent: fix-defect
Scope: auth/login`;

  const { body, trailerLines } = splitHeaderBodyTrailers(rawBody);

  // Body should be empty or minimal
  assertEquals(body, "");
  assert(trailerLines.length >= 2);
});

Deno.test("splitHeaderBodyTrailers: mixed non-trailer and trailer-like lines in body", () => {
  const rawBody = `
The setting DATABASE_URL: postgres://localhost is important.
Another line here.

Intent: configure-infra
Scope: infra/database`;

  const { body, trailerLines } = splitHeaderBodyTrailers(rawBody);

  assert(body.includes("DATABASE_URL: postgres://localhost"));
  assert(body.includes("Another line here."));
  assertEquals(trailerLines.length, 2);
});

// ---------------------------------------------------------------------------
// parseCommitBlock
// ---------------------------------------------------------------------------

Deno.test("parseCommitBlock: parses a complete valid commit", () => {
  const block = `
Hash: abc123def456
Date: 2025-02-08T10:30:00+00:00
Subject: feat(auth): add passkey registration for agent identities

Implement WebAuthn registration flow supporting non-human identity types.

Intent: enable-capability
Scope: auth/registration, identity/agent
Decided-Against: OAuth2 client credentials (no hardware binding guarantee)
Session: 2025-02-08/passkey-lib`;

  const result = parseCommitBlock(block);
  assert(result.ok);

  const commit = result.value;
  assertEquals(commit.hash, "abc123def456");
  assertEquals(commit.date, "2025-02-08T10:30:00+00:00");
  assertEquals(commit.type, "feat");
  assertEquals(commit.headerScope, "auth");
  assertEquals(commit.subject, "add passkey registration for agent identities");
  assert(commit.body.includes("WebAuthn registration flow"));
  assertEquals(commit.intent, "enable-capability");
  assertEquals(commit.scope, ["auth/registration", "identity/agent"]);
  assertEquals(commit.decidedAgainst, [
    "OAuth2 client credentials (no hardware binding guarantee)",
  ]);
  assertEquals(commit.session, "2025-02-08/passkey-lib");
});

Deno.test("parseCommitBlock: parses commit with Context JSON", () => {
  const block = `
Hash: def789abc012
Date: 2025-02-07T14:00:00+00:00
Subject: feat(search): prototype vector similarity search with pgvector

Spike to validate pgvector performance.

Intent: explore
Scope: search/vector, infra/postgres
Context: {"benchmark":{"p50_ms":12,"p99_ms":45,"rows":"2M"}}`;

  const result = parseCommitBlock(block);
  assert(result.ok);

  const commit = result.value;
  assertEquals(commit.intent, "explore");
  assert(commit.context !== null);
  assertEquals(
    (commit.context!.benchmark as Record<string, unknown>).p50_ms,
    12,
  );
});

Deno.test("parseCommitBlock: handles commit with no scope in header", () => {
  const block = `
Hash: 111222333444
Date: 2025-02-08T12:00:00+00:00
Subject: chore: update dependencies

Routine dependency update.

Intent: configure-infra
Scope: infra/dependencies`;

  const result = parseCommitBlock(block);
  assert(result.ok);

  assertEquals(result.value.type, "chore");
  assertEquals(result.value.headerScope, null);
});

Deno.test("parseCommitBlock: handles breaking change trailer", () => {
  const block = `
Hash: aaa111bbb222
Date: 2025-02-08T09:00:00+00:00
Subject: feat(api)!: change response format

New paginated response format.

Intent: enable-capability
Scope: api/users
Breaking: /api/v2/users response changed from array to paginated object`;

  const result = parseCommitBlock(block);
  assert(result.ok);

  assertEquals(
    result.value.breaking,
    "/api/v2/users response changed from array to paginated object",
  );
});

Deno.test("parseCommitBlock: fails on missing Hash line", () => {
  const block = `
Date: 2025-02-08T10:00:00+00:00
Subject: feat(auth): add login`;

  const result = parseCommitBlock(block);
  assert(!result.ok);
  assert(result.error.reason.includes("Missing required fields"));
});

Deno.test("parseCommitBlock: fails on non-conventional subject", () => {
  const block = `
Hash: 999888777666
Date: 2025-02-08T10:00:00+00:00
Subject: this is not a conventional commit`;

  const result = parseCommitBlock(block);
  assert(!result.ok);
  assert(result.error.reason.includes("Conventional Commits format"));
});

Deno.test("parseCommitBlock: handles commit with Refs trailer", () => {
  const block = `
Hash: ref123abc456
Date: 2025-02-08T11:00:00+00:00
Subject: fix(api): prevent duplicate webhook delivery

Fix race condition.

Intent: fix-defect
Scope: api/webhooks
Refs: #1847, abc123f`;

  const result = parseCommitBlock(block);
  assert(result.ok);

  assertEquals(result.value.refs, ["#1847", "abc123f"]);
});

Deno.test("parseCommitBlock: null intent for invalid intent value", () => {
  const block = `
Hash: bad123intent
Date: 2025-02-08T10:00:00+00:00
Subject: feat(auth): add something

Body text.

Intent: not-a-valid-intent
Scope: auth/login`;

  const result = parseCommitBlock(block);
  assert(result.ok);
  assertEquals(result.value.intent, null);
});

// ---------------------------------------------------------------------------
// isIntentType
// ---------------------------------------------------------------------------

Deno.test("splitHeaderBodyTrailers: trailers separated by blank line from Co-Authored-By", () => {
  const rawBody = `
Create onboarding documentation.

Intent: document
Scope: docs/onboarding
Decided-Against: separate getting-started guide (adds navigation overhead)
Session: 2025-02-08/initial-release

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
`;

  const { body, trailerLines } = splitHeaderBodyTrailers(rawBody);

  assertEquals(body, "Create onboarding documentation.");
  assert(trailerLines.some((l) => l.includes("Intent: document")));
  assert(trailerLines.some((l) => l.includes("Scope: docs/onboarding")));
  assert(trailerLines.some((l) => l.includes("Session:")));
  assert(trailerLines.some((l) => l.includes("Decided-Against:")));
  assert(trailerLines.some((l) => l.includes("Co-Authored-By:")));
});

Deno.test("isIntentType: accepts valid intents", () => {
  assert(isIntentType("enable-capability"));
  assert(isIntentType("fix-defect"));
  assert(isIntentType("improve-quality"));
  assert(isIntentType("restructure"));
  assert(isIntentType("configure-infra"));
  assert(isIntentType("document"));
  assert(isIntentType("explore"));
  assert(isIntentType("resolve-blocker"));
});

Deno.test("isIntentType: rejects invalid intents", () => {
  assert(!isIntentType("feature"));
  assert(!isIntentType("bugfix"));
  assert(!isIntentType(""));
  assert(!isIntentType("enable_capability"));
});
