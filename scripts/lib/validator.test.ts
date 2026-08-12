import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";
import {
  validate,
  validateBody,
  validateHeader,
  validateTrailers,
} from "./validator.ts";

// ---------------------------------------------------------------------------
// validateHeader
// ---------------------------------------------------------------------------

Deno.test("validateHeader: valid header produces no diagnostics", () => {
  const result = validateHeader("feat(auth): Add passkey registration");
  assertEquals(result.length, 0);
});

Deno.test("validateHeader: header without scope is valid", () => {
  const result = validateHeader("chore: Update dependencies");
  assertEquals(result.length, 0);
});

Deno.test("validateHeader: header over 72 chars produces error", () => {
  const long = "feat(auth): A" + "a".repeat(70);
  const result = validateHeader(long);

  assert(result.some((d) => d.rule === "header-max-length"));
  assert(result.some((d) => d.severity === "error"));
});

Deno.test("validateHeader: header over 50 chars produces warning", () => {
  const header = "feat(auth): Add passkey registration for agent identities";
  const result = validateHeader(header);

  assert(result.some((d) => d.rule === "header-recommended-length"));
  assertEquals(
    result.find((d) => d.rule === "header-recommended-length")!.severity,
    "warning",
  );
});

Deno.test("validateHeader: header over 72 chars warns once, not twice", () => {
  const long = "feat(auth): A" + "a".repeat(70);
  const result = validateHeader(long);

  assert(!result.some((d) => d.rule === "header-recommended-length"));
});

Deno.test("validateHeader: lowercase subject produces warning", () => {
  const result = validateHeader("feat(auth): add passkey registration");

  assert(result.some((d) => d.rule === "subject-capitalized"));
  assertEquals(
    result.find((d) => d.rule === "subject-capitalized")!.severity,
    "warning",
  );
});

Deno.test("validateHeader: code identifier subject skips capitalization warning", () => {
  const result = validateHeader("refactor(parser): parseCommit now returns Result");

  assert(!result.some((d) => d.rule === "subject-capitalized"));
});

Deno.test("validateHeader: third-person subject produces warning", () => {
  const result = validateHeader("feat(auth): Adds login flow");

  assert(result.some((d) => d.rule === "subject-imperative"));
});

Deno.test("validateHeader: imperative verb ending in -ed is accepted", () => {
  const result = validateHeader("perf(parser): Speed up trailer extraction");

  assert(!result.some((d) => d.rule === "subject-imperative"));
});

Deno.test("validateHeader: invalid format produces error", () => {
  const result = validateHeader("this is not a valid header");

  assert(result.some((d) => d.rule === "header-format"));
  assert(result.some((d) => d.severity === "error"));
});

Deno.test("validateHeader: period at end produces warning", () => {
  const result = validateHeader("feat(auth): add login flow.");

  assert(result.some((d) => d.rule === "subject-no-period"));
  assertEquals(result.find((d) => d.rule === "subject-no-period")!.severity, "warning");
});

Deno.test("validateHeader: past tense subject produces warning", () => {
  const result = validateHeader("feat(auth): added login flow");

  assert(result.some((d) => d.rule === "subject-imperative"));
  assertEquals(
    result.find((d) => d.rule === "subject-imperative")!.severity,
    "warning",
  );
});

Deno.test("validateHeader: gerund subject produces warning", () => {
  const result = validateHeader("feat(auth): adding login flow");

  assert(result.some((d) => d.rule === "subject-imperative"));
});

Deno.test("validateHeader: breaking change marker is valid", () => {
  const result = validateHeader("feat(api)!: Change response format");
  assertEquals(result.length, 0);
});

// ---------------------------------------------------------------------------
// validateTrailers
// ---------------------------------------------------------------------------

Deno.test("validateTrailers: valid trailers produce no errors", () => {
  const lines = [
    "Intent: enable-capability",
    "Scope: auth/registration, identity/agent",
  ];
  const result = validateTrailers(lines);
  const errors = result.filter((d) => d.severity === "error");
  assertEquals(errors.length, 0);
});

Deno.test("validateTrailers: missing Intent produces error", () => {
  const lines = ["Scope: auth/registration"];
  const result = validateTrailers(lines);

  assert(result.some((d) => d.rule === "intent-required"));
});

Deno.test("validateTrailers: invalid Intent produces error", () => {
  const lines = [
    "Intent: not-a-real-intent",
    "Scope: auth/registration",
  ];
  const result = validateTrailers(lines);

  assert(result.some((d) => d.rule === "intent-valid"));
});

Deno.test("validateTrailers: multiple Intent entries produces error", () => {
  const lines = [
    "Intent: enable-capability",
    "Intent: fix-defect",
    "Scope: auth/registration",
  ];
  const result = validateTrailers(lines);

  assert(result.some((d) => d.rule === "intent-single"));
});

Deno.test("validateTrailers: missing Scope produces error", () => {
  const lines = ["Intent: fix-defect"];
  const result = validateTrailers(lines);

  assert(result.some((d) => d.rule === "scope-required"));
});

Deno.test("validateTrailers: more than 3 scope entries produces warning", () => {
  const lines = [
    "Intent: restructure",
    "Scope: auth/session, api/middleware, orders/pricing, billing/invoices",
  ];
  const result = validateTrailers(lines);

  assert(result.some((d) => d.rule === "scope-max-entries"));
  assertEquals(
    result.find((d) => d.rule === "scope-max-entries")!.severity,
    "warning",
  );
});

Deno.test("validateTrailers: scope without slash produces warning", () => {
  const lines = [
    "Intent: fix-defect",
    "Scope: backend",
  ];
  const result = validateTrailers(lines);

  assert(result.some((d) => d.rule === "scope-format"));
  assertEquals(
    result.find((d) => d.rule === "scope-format")!.severity,
    "warning",
  );
});

Deno.test("validateTrailers: scope with slash produces no scope-format warning", () => {
  const lines = [
    "Intent: fix-defect",
    "Scope: auth/session",
  ];
  const result = validateTrailers(lines);

  assert(!result.some((d) => d.rule === "scope-format"));
});

Deno.test("validateTrailers: invalid Session format produces warning", () => {
  const lines = [
    "Intent: explore",
    "Scope: search/vector",
    "Session: passkey-work",
  ];
  const result = validateTrailers(lines);

  assert(result.some((d) => d.rule === "session-format"));
  assertEquals(
    result.find((d) => d.rule === "session-format")!.severity,
    "warning",
  );
});

Deno.test("validateTrailers: valid Session format is accepted", () => {
  const lines = [
    "Intent: explore",
    "Scope: search/vector",
    "Session: 2025-02-08/passkey-lib",
  ];
  const result = validateTrailers(lines);

  assert(!result.some((d) => d.rule === "session-format"));
});

Deno.test("validateTrailers: invalid Context JSON produces error", () => {
  const lines = [
    "Intent: explore",
    "Scope: search/vector",
    "Context: {invalid json}",
  ];
  const result = validateTrailers(lines);

  assert(result.some((d) => d.rule === "context-valid-json"));
});

Deno.test("validateTrailers: valid Context JSON is accepted", () => {
  const lines = [
    "Intent: explore",
    "Scope: search/vector",
    'Context: {"p50_ms":12,"p99_ms":45}',
  ];
  const result = validateTrailers(lines);

  assert(!result.some((d) => d.rule === "context-valid-json"));
});

// ---------------------------------------------------------------------------
// validateBody
// ---------------------------------------------------------------------------

Deno.test("validateBody: non-empty body produces no diagnostics", () => {
  const result = validateBody(
    "Implement WebAuthn registration flow.",
    "feat(auth): Add passkey registration",
  );
  assertEquals(result.length, 0);
});

Deno.test("validateBody: line over 72 chars produces wrap warning", () => {
  const result = validateBody(
    "Implement the WebAuthn registration flow for non-human identity types today.",
    "feat(auth): Add passkey registration",
  );

  assert(result.some((d) => d.rule === "body-wrap"));
  assertEquals(result.find((d) => d.rule === "body-wrap")!.severity, "warning");
});

Deno.test("validateBody: unbreakable single-token line is exempt from wrap", () => {
  const result = validateBody(
    `See the design note:\nhttps://example.com/${"a".repeat(80)}`,
    "feat(auth): Add passkey registration",
  );

  assert(!result.some((d) => d.rule === "body-wrap"));
});

Deno.test("validateBody: fenced code block is exempt from wrap", () => {
  const result = validateBody(
    "Run this:\n\n```\n" + "deno task validate --input " + "x".repeat(60) +
      "\n```",
    "feat(auth): Add passkey registration",
  );

  assert(!result.some((d) => d.rule === "body-wrap"));
});

Deno.test("validateBody: empty body for feat produces warning", () => {
  const result = validateBody("", "feat(auth): Add passkey registration");

  assert(result.some((d) => d.rule === "body-present"));
  assertEquals(result.find((d) => d.rule === "body-present")!.severity, "warning");
});

Deno.test("validateBody: empty body for chore is acceptable", () => {
  const result = validateBody("", "chore: update lockfile");
  assertEquals(result.length, 0);
});

Deno.test("validateBody: empty body for ci is acceptable", () => {
  const result = validateBody("", "ci: add caching step");
  assertEquals(result.length, 0);
});

Deno.test("validateBody: empty body for build is acceptable", () => {
  const result = validateBody("", "build: update deno.json");
  assertEquals(result.length, 0);
});

// ---------------------------------------------------------------------------
// validate (integration)
// ---------------------------------------------------------------------------

Deno.test("validate: fully valid commit produces no diagnostics", () => {
  const msg = `feat(auth): Add passkey registration for agents

Implement WebAuthn registration for non-human identity types.

Intent: enable-capability
Scope: auth/registration, identity/agent
Decided-Against: OAuth2 client credentials (no hardware binding guarantee)
Session: 2025-02-08/passkey-lib`;

  const result = validate(msg);
  assertEquals(result.length, 0);
});

Deno.test("validate: missing blank line after subject produces error", () => {
  const msg = `feat(auth): Add passkey registration
Implement WebAuthn registration for non-human identity types.

Intent: enable-capability
Scope: auth/registration`;

  const result = validate(msg);

  assert(result.some((d) => d.rule === "subject-blank-line"));
  assertEquals(
    result.find((d) => d.rule === "subject-blank-line")!.severity,
    "error",
  );
});

Deno.test("validate: trailers may exceed the body wrap limit", () => {
  const msg = `fix(api): Prevent duplicate webhook delivery

Retry scheduler and delivery confirmation raced inside the timeout.

Intent: fix-defect
Scope: api/webhooks
Decided-Against: idempotency key at the receiver (shifts burden to every consumer)`;

  const result = validate(msg);

  assert(!result.some((d) => d.rule === "body-wrap"));
});

Deno.test("validate: empty message produces header-format error", () => {
  const result = validate("");
  const errors = result.filter((d) => d.severity === "error");
  assert(errors.length > 0);
  assert(result.some((d) => d.rule === "header-format"));
});

Deno.test("validate: missing trailers produces errors", () => {
  const msg = `feat(auth): add passkey registration

Implement WebAuthn registration flow.`;

  const result = validate(msg);
  assert(result.some((d) => d.rule === "intent-required"));
  assert(result.some((d) => d.rule === "scope-required"));
});

Deno.test("validate: trailer-blank-line enforced when body runs into trailers", () => {
  const msg = `feat(auth): add passkey registration

Implement WebAuthn registration flow.
Intent: enable-capability
Scope: auth/registration`;

  const result = validate(msg);
  // When body runs directly into trailers without blank line,
  // the trailers won't be recognized (they'll be part of the body)
  // so we should see intent-required and scope-required errors
  const errors = result.filter((d) => d.severity === "error");
  assert(errors.length > 0);
});

Deno.test("validate: URL-like body line does not confuse trailer detection", () => {
  const msg = `feat(api): add webhook endpoint

Configure via WEBHOOK_URL: https://example.com

Intent: enable-capability
Scope: api/webhooks`;

  const result = validate(msg);
  const errors = result.filter((d) => d.severity === "error");
  assertEquals(errors.length, 0);
});

Deno.test("validate: scope format warning for flat scopes", () => {
  const msg = `fix(auth): fix login bug

Fix the auth bug.

Intent: fix-defect
Scope: backend`;

  const result = validate(msg);
  assert(result.some((d) => d.rule === "scope-format"));
});

Deno.test("validate: minimal valid commit (trivial type)", () => {
  const msg = `chore: Update lockfile

Intent: configure-infra
Scope: infra/dependencies`;

  const result = validate(msg);
  const errors = result.filter((d) => d.severity === "error");
  assertEquals(errors.length, 0);
});
