import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";
import { buildIndex, checkFreshness, loadIndex } from "../build-trailer-index.ts";
import type { TrailerIndex } from "../types.ts";

// These tests spawn git subprocesses, so we disable resource/op sanitizers
const testOpts = { sanitizeResources: false, sanitizeOps: false };

// ---------------------------------------------------------------------------
// buildIndex
// ---------------------------------------------------------------------------

Deno.test({
  name: "buildIndex: produces a valid TrailerIndex structure",
  ...testOpts,
  fn: async () => {
    const result = await buildIndex();
    assert(result.ok, `Expected ok but got error: ${!result.ok ? result.error.message : ""}`);

    const index: TrailerIndex = result.value;
    assertEquals(index.version, 1);
    assert(index.generated.length > 0, "Should have a generated timestamp");
    assert(index.headCommit.length > 0, "Should have a HEAD commit hash");
    assert(index.commitCount >= 0, "commitCount should be non-negative");
    assert(typeof index.byIntent === "object", "byIntent should be an object");
    assert(typeof index.byScope === "object", "byScope should be an object");
    assert(typeof index.bySession === "object", "bySession should be an object");
    assert(Array.isArray(index.withDecidedAgainst), "withDecidedAgainst should be an array");
    assert(typeof index.commits === "object", "commits should be an object");
  },
});

Deno.test({
  name: "buildIndex: indexed commits have required fields",
  ...testOpts,
  fn: async () => {
    const result = await buildIndex();
    assert(result.ok);

    const index = result.value;
    for (const [hash, commit] of Object.entries(index.commits)) {
      assertEquals(commit.hash, hash, "Commit hash key should match stored hash");
      assert(commit.date.length > 0, "Commit should have a date");
      assert(commit.subject.length > 0, "Commit should have a subject");
      assert(Array.isArray(commit.scope), "Scope should be an array");
      assert(Array.isArray(commit.decidedAgainst), "decidedAgainst should be an array");
    }
  },
});

Deno.test({
  name: "buildIndex: byIntent values reference valid commits",
  ...testOpts,
  fn: async () => {
    const result = await buildIndex();
    assert(result.ok);

    const index = result.value;
    for (const [intent, hashes] of Object.entries(index.byIntent)) {
      assert(hashes !== undefined, `Intent ${intent} should have hashes`);
      for (const hash of hashes!) {
        assert(
          hash in index.commits,
          `Hash ${hash} from byIntent[${intent}] should exist in commits`,
        );
        assertEquals(
          index.commits[hash].intent,
          intent,
          `Commit ${hash} intent should match index key ${intent}`,
        );
      }
    }
  },
});

Deno.test({
  name: "buildIndex: byScope values reference valid commits",
  ...testOpts,
  fn: async () => {
    const result = await buildIndex();
    assert(result.ok);

    const index = result.value;
    for (const [scope, hashes] of Object.entries(index.byScope)) {
      for (const hash of hashes) {
        assert(
          hash in index.commits,
          `Hash ${hash} from byScope[${scope}] should exist in commits`,
        );
        assert(
          index.commits[hash].scope.includes(scope),
          `Commit ${hash} scope should include ${scope}`,
        );
      }
    }
  },
});

Deno.test({
  name: "buildIndex: bySession values reference valid commits",
  ...testOpts,
  fn: async () => {
    const result = await buildIndex();
    assert(result.ok);

    const index = result.value;
    for (const [session, hashes] of Object.entries(index.bySession)) {
      for (const hash of hashes) {
        assert(
          hash in index.commits,
          `Hash ${hash} from bySession[${session}] should exist in commits`,
        );
        assertEquals(
          index.commits[hash].session,
          session,
          `Commit ${hash} session should match index key ${session}`,
        );
      }
    }
  },
});

Deno.test({
  name: "buildIndex: withDecidedAgainst commits have decided-against entries",
  ...testOpts,
  fn: async () => {
    const result = await buildIndex();
    assert(result.ok);

    const index = result.value;
    for (const hash of index.withDecidedAgainst) {
      assert(
        hash in index.commits,
        `Hash ${hash} from withDecidedAgainst should exist in commits`,
      );
      assert(
        index.commits[hash].decidedAgainst.length > 0,
        `Commit ${hash} should have at least one decided-against entry`,
      );
    }
  },
});

// ---------------------------------------------------------------------------
// checkFreshness
// ---------------------------------------------------------------------------

Deno.test({
  name: "checkFreshness: reports stale when no index exists",
  ...testOpts,
  fn: async () => {
    // Remove index if it exists (clean state)
    try {
      const cmd = new Deno.Command("git", {
        args: ["rev-parse", "--git-dir"],
        stdout: "piped",
      });
      const out = await cmd.output();
      const gitDir = new TextDecoder().decode(out.stdout).trim();
      await Deno.remove(`${gitDir}/info/trailer-index.json`);
    } catch {
      // File may not exist, that's fine
    }

    const result = await checkFreshness();
    assert(result.ok);
    assertEquals(result.value.fresh, false, "Should report stale when no index exists");
  },
});

// ---------------------------------------------------------------------------
// loadIndex (round-trip)
// ---------------------------------------------------------------------------

Deno.test({
  name: "loadIndex: returns fresh index after build-and-write",
  ...testOpts,
  fn: async () => {
    // Build and write the index
    const buildResult = await buildIndex();
    assert(buildResult.ok);

    const cmd = new Deno.Command("git", {
      args: ["rev-parse", "--git-dir"],
      stdout: "piped",
    });
    const out = await cmd.output();
    const gitDir = new TextDecoder().decode(out.stdout).trim();
    const indexPath = `${gitDir}/info/trailer-index.json`;

    await Deno.writeTextFile(indexPath, JSON.stringify(buildResult.value, null, 2));

    // Load should succeed with fresh index
    const loadResult = await loadIndex();
    assert(loadResult.ok);
    assert(loadResult.value !== null, "Should return non-null index when fresh");
    assertEquals(loadResult.value!.version, 1);
    assertEquals(loadResult.value!.headCommit, buildResult.value.headCommit);
  },
});
