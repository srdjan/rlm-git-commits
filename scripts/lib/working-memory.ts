/**
 * Working memory persistence for cross-prompt state within a session.
 *
 * Maps the RLM concept of "REPL variables" to a JSON file at
 * `.git/info/working-memory.json`, scoped to the current session.
 *
 * Entries are tagged (finding, hypothesis, decision, context, todo)
 * and can optionally reference a source commit hash or file path.
 */

import { Result } from "../types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntryTag = "finding" | "hypothesis" | "decision" | "context" | "todo";

export const ENTRY_TAGS: readonly EntryTag[] = [
  "finding",
  "hypothesis",
  "decision",
  "context",
  "todo",
];

export interface WorkingMemoryEntry {
  readonly timestamp: string;
  readonly tag: EntryTag;
  readonly scope: readonly string[];
  readonly text: string;
  readonly source: string | null;
}

export interface WorkingMemory {
  readonly version: 1;
  readonly sessionId: string;
  readonly created: string;
  readonly updated: string;
  readonly entries: readonly WorkingMemoryEntry[];
}

// ---------------------------------------------------------------------------
// File Path
// ---------------------------------------------------------------------------

const getGitDir = async (): Promise<Result<string>> => {
  try {
    const command = new Deno.Command("git", {
      args: ["rev-parse", "--git-dir"],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    if (!output.success) {
      return Result.fail(new Error("Not a git repository"));
    }
    return Result.ok(new TextDecoder().decode(output.stdout).trim());
  } catch (e) {
    return Result.fail(e as Error);
  }
};

export const getWorkingMemoryPath = async (): Promise<Result<string>> => {
  const gitDirResult = await getGitDir();
  if (!gitDirResult.ok) return gitDirResult;
  return Result.ok(`${gitDirResult.value}/info/working-memory.json`);
};

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export const loadWorkingMemory = async (
  sessionId: string,
): Promise<Result<WorkingMemory | null>> => {
  const pathResult = await getWorkingMemoryPath();
  if (!pathResult.ok) return pathResult as Result<never>;

  try {
    const content = await Deno.readTextFile(pathResult.value);
    const data: WorkingMemory = JSON.parse(content);

    // Session mismatch: return null (stale from a different session)
    if (data.sessionId !== sessionId) {
      return Result.ok(null);
    }

    if (data.version !== 1) {
      return Result.ok(null);
    }

    return Result.ok(data);
  } catch {
    // File doesn't exist or is corrupt
    return Result.ok(null);
  }
};

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

const saveWorkingMemory = async (
  memory: WorkingMemory,
): Promise<Result<void>> => {
  const pathResult = await getWorkingMemoryPath();
  if (!pathResult.ok) return pathResult as Result<never>;

  try {
    await Deno.writeTextFile(
      pathResult.value,
      JSON.stringify(memory, null, 2),
    );
    return Result.ok(undefined);
  } catch (e) {
    return Result.fail(e as Error);
  }
};

// ---------------------------------------------------------------------------
// Add Entry
// ---------------------------------------------------------------------------

export const addEntry = async (
  sessionId: string,
  entry: Omit<WorkingMemoryEntry, "timestamp">,
): Promise<Result<WorkingMemory>> => {
  const now = new Date().toISOString();
  const existing = await loadWorkingMemory(sessionId);
  if (!existing.ok) return existing as Result<never>;

  const fullEntry: WorkingMemoryEntry = {
    ...entry,
    timestamp: now,
  };

  const memory: WorkingMemory = existing.value
    ? {
        ...existing.value,
        updated: now,
        entries: [...existing.value.entries, fullEntry],
      }
    : {
        version: 1,
        sessionId,
        created: now,
        updated: now,
        entries: [fullEntry],
      };

  const saveResult = await saveWorkingMemory(memory);
  if (!saveResult.ok) return saveResult as Result<never>;

  return Result.ok(memory);
};

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

export const clearWorkingMemory = async (): Promise<Result<void>> => {
  const pathResult = await getWorkingMemoryPath();
  if (!pathResult.ok) return pathResult as Result<never>;

  try {
    await Deno.remove(pathResult.value);
    return Result.ok(undefined);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return Result.ok(undefined);
    }
    return Result.fail(e as Error);
  }
};

// ---------------------------------------------------------------------------
// Format for Context Injection
// ---------------------------------------------------------------------------

export const formatWorkingMemory = (
  memory: WorkingMemory,
  limit: number = 20,
): string => {
  if (memory.entries.length === 0) return "";

  const entries = memory.entries.slice(-limit); // Most recent entries
  const lines: string[] = [];

  for (const entry of entries) {
    const scopeLabel = entry.scope.length > 0
      ? ` [${entry.scope.join(", ")}]`
      : "";
    const sourceLabel = entry.source ? ` (${entry.source})` : "";
    lines.push(`[${entry.tag}]${scopeLabel} ${entry.text}${sourceLabel}`);
  }

  return `<working-memory session="${memory.sessionId}" entries="${entries.length}">\n${lines.join("\n")}\n</working-memory>`;
};
