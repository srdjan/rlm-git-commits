/**
 * Git Memory Consolidation - Stop Hook and CLI
 *
 * Consolidates working memory into durable artifacts when a Claude Code
 * session ends:
 *   - Writes a Markdown session summary to `.git/info/session-summary-{slug}.md`
 *   - Optionally outputs commit trailer hints (--commit-hints flag)
 *
 * As a Stop hook: runs silently, writes summary file, exits 0.
 * As a CLI: `deno task memory:consolidate -- --commit-hints` outputs trailer suggestions.
 *
 * Usage:
 *   deno run --allow-run --allow-read --allow-write --allow-env scripts/git-memory-consolidate.ts [--commit-hints]
 */

import { loadWorkingMemory, getWorkingMemoryPath } from "./lib/working-memory.ts";
import {
  decisionsToTrailers,
  formatSessionSummary,
  formatTrailerHints,
} from "./lib/consolidation.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getGitDir = async (): Promise<string | null> => {
  try {
    const command = new Deno.Command("git", {
      args: ["rev-parse", "--git-dir"],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    if (!output.success) return null;
    return new TextDecoder().decode(output.stdout).trim();
  } catch {
    return null;
  }
};

const sessionSlug = (sessionId: string): string =>
  sessionId.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();

// ---------------------------------------------------------------------------
// Drain stdin (Stop hook sends JSON on stdin)
// ---------------------------------------------------------------------------

const drainStdin = async (): Promise<void> => {
  try {
    if (!Deno.stdin.isTerminal()) {
      await Deno.stdin.readable.cancel();
    }
  } catch {
    // ignore
  }
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  // Drain stdin first (Stop hook sends JSON we don't need)
  await drainStdin();

  const commitHints = Deno.args.includes("--commit-hints");

  // Prevent hook loops
  if (Deno.env.get("stop_hook_active") === "true") return;

  const sessionId = Deno.env.get("STRUCTURED_GIT_SESSION") ?? null;
  if (!sessionId) {
    if (commitHints) {
      console.error("No STRUCTURED_GIT_SESSION set.");
    }
    return;
  }

  const result = await loadWorkingMemory(sessionId);
  if (!result.ok || !result.value) {
    if (commitHints) {
      console.log("No working memory entries for this session.");
    }
    return;
  }

  const memory = result.value;

  if (commitHints) {
    // CLI mode: output trailer hints
    const hints = decisionsToTrailers(memory.entries);
    const output = formatTrailerHints(hints);
    if (output) {
      console.log("Suggested trailers from working memory:");
      console.log(output);
    } else {
      console.log("No trailer hints available (no decision entries).");
    }
    return;
  }

  // Stop hook mode: write session summary silently
  if (memory.entries.length === 0) return;

  const gitDir = await getGitDir();
  if (!gitDir) return;

  const slug = sessionSlug(sessionId);
  const summaryPath = `${gitDir}/info/session-summary-${slug}.md`;

  try {
    const summary = formatSessionSummary(memory);
    await Deno.writeTextFile(summaryPath, summary);
  } catch {
    // Stop hook: fail silently
  }
};

if (import.meta.main) {
  main();
}
