/**
 * Working Memory Write - CLI
 *
 * Persists discoveries, decisions, and context to working memory during
 * a Claude Code session. Working memory entries survive across prompts
 * within the same session.
 *
 * Usage:
 *   deno run --allow-run --allow-read --allow-write --allow-env scripts/working-memory-write.ts [options]
 *
 * Options:
 *   --tag=<tag>        Entry tag: finding, hypothesis, decision, context, todo
 *   --scope=<scope>    Comma-separated scope values (e.g., "auth/login,auth")
 *   --text=<text>      Entry text content
 *   --source=<source>  Optional source reference (commit hash, file path)
 *   --clear            Clear all working memory
 */

import { addEntry, clearWorkingMemory, ENTRY_TAGS, type EntryTag } from "./lib/working-memory.ts";

// ---------------------------------------------------------------------------
// Arg Parsing
// ---------------------------------------------------------------------------

interface WriteArgs {
  readonly tag: EntryTag;
  readonly scope: readonly string[];
  readonly text: string;
  readonly source: string | null;
}

const parseArgs = (args: readonly string[]): { clear: true } | { clear: false; write: WriteArgs } | { error: string } => {
  if (args.includes("--clear")) {
    return { clear: true };
  }

  let tag: string | null = null;
  let scope: string | null = null;
  let text: string | null = null;
  let source: string | null = null;

  for (const arg of args) {
    if (arg.startsWith("--tag=")) tag = arg.slice(6);
    else if (arg.startsWith("--scope=")) scope = arg.slice(8);
    else if (arg.startsWith("--text=")) text = arg.slice(7);
    else if (arg.startsWith("--source=")) source = arg.slice(9);
  }

  if (!tag) return { error: "Missing --tag" };
  if (!text) return { error: "Missing --text" };

  if (!ENTRY_TAGS.includes(tag as EntryTag)) {
    return { error: `Invalid tag "${tag}". Valid: ${ENTRY_TAGS.join(", ")}` };
  }

  const scopeValues = scope
    ? scope.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    clear: false,
    write: {
      tag: tag as EntryTag,
      scope: scopeValues,
      text,
      source: source || null,
    },
  };
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const parsed = parseArgs(Deno.args);

  if ("error" in parsed) {
    console.error(`Error: ${parsed.error}`);
    Deno.exit(1);
  }

  if (parsed.clear) {
    const result = await clearWorkingMemory();
    if (!result.ok) {
      console.error(`Error clearing working memory: ${result.error.message}`);
      Deno.exit(1);
    }
    console.log("Working memory cleared.");
    return;
  }

  const sessionId = Deno.env.get("STRUCTURED_GIT_SESSION") ?? null;
  if (!sessionId) {
    console.error("Error: STRUCTURED_GIT_SESSION not set. Working memory requires a session.");
    Deno.exit(1);
  }

  const result = await addEntry(sessionId, parsed.write);
  if (!result.ok) {
    console.error(`Error writing entry: ${result.error.message}`);
    Deno.exit(1);
  }

  console.log(`Added [${parsed.write.tag}] entry (${result.value.entries.length} total).`);
};

if (import.meta.main) {
  main();
}
