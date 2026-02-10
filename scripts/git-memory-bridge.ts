/**
 * Git Memory Bridge - PostToolUse Hook
 *
 * Closes the observe-act-observe loop from the RLM pattern. When Claude
 * runs a `deno task parse` git query, this hook detects the query parameters
 * and surfaces related context the query didn't directly ask for:
 *
 *   - Decided-against entries in the queried scope (if the query was scope-filtered)
 *   - Sibling scopes with the same intent (if the query was intent+scope filtered)
 *
 * When local LLM mode is enabled, the heuristic output is passed through
 * analyzeBridgeContext() for a more focused summary.
 *
 * Non-query Bash commands exit immediately with no output. The hook runs
 * async so it does not block the Bash tool execution.
 *
 * Usage (via .claude/settings.json PostToolUse hook):
 *   deno run --allow-run --allow-read --allow-env --allow-net scripts/git-memory-bridge.ts
 */

import type { IndexedCommit, TrailerIndex } from "./types.ts";
import { loadIndex } from "./build-trailer-index.ts";
import { parseQueryCommand, type ParsedQueryCommand } from "./lib/command-parser.ts";
import { scopeMatches } from "./lib/matching.ts";
import { loadRlmConfig } from "./lib/rlm-config.ts";
import { analyzeBridgeContext } from "./lib/rlm-subcalls.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BRIDGE_ENTRIES = 5;

// ---------------------------------------------------------------------------
// Stdin Parsing
// ---------------------------------------------------------------------------

interface HookInput {
  readonly hook_event_name: string;
  readonly tool_name: string;
  readonly tool_input: { readonly command?: string };
  readonly tool_response?: { readonly stdout?: string };
}

const readHookInput = async (): Promise<HookInput | null> => {
  try {
    if (Deno.stdin.isTerminal()) return null;
    const buf = new Uint8Array(131072);
    const n = await Deno.stdin.read(buf);
    if (n === null) return null;
    const text = new TextDecoder().decode(buf.subarray(0, n));
    return JSON.parse(text) as HookInput;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Bridge Context Generation
// ---------------------------------------------------------------------------

interface BridgeContext {
  readonly decisions: readonly {
    readonly scope: readonly string[];
    readonly text: string;
  }[];
  readonly siblingScopes: readonly {
    readonly scope: string;
    readonly commitCount: number;
  }[];
}

const generateBridgeContext = (
  index: TrailerIndex,
  query: ParsedQueryCommand,
): BridgeContext | null => {
  const decisions: BridgeContext["decisions"][number][] = [];
  const siblingScopes: BridgeContext["siblingScopes"][number][] = [];

  // If query was scope-filtered: surface decided-against entries in that scope
  if (query.scope && !query.decidedAgainst && !query.decisionsOnly) {
    for (const hash of index.withDecidedAgainst) {
      if (decisions.length >= MAX_BRIDGE_ENTRIES) break;
      const commit = index.commits[hash];
      if (!commit) continue;

      const inScope = commit.scope.some((s) => scopeMatches(s, query.scope!));
      if (!inScope) continue;

      for (const text of commit.decidedAgainst) {
        if (decisions.length >= MAX_BRIDGE_ENTRIES) break;
        decisions.push({ scope: commit.scope, text });
      }
    }
  }

  // If query had intent + scope: find sibling scopes with the same intent
  if (query.scope && query.intents.length > 0) {
    const queryScopePrefix = query.scope.split("/")[0];
    const seen = new Set<string>();

    for (const intent of query.intents) {
      const hashes = index.byIntent[intent] ?? [];
      for (const hash of hashes) {
        const commit = index.commits[hash];
        if (!commit) continue;

        for (const scope of commit.scope) {
          // Sibling: shares the top-level segment but is not the queried scope
          const topLevel = scope.split("/")[0];
          if (topLevel !== queryScopePrefix) continue;
          if (scopeMatches(scope, query.scope)) continue;
          if (seen.has(scope)) continue;

          seen.add(scope);
        }
      }
    }

    // Count commits per sibling scope
    for (const scope of seen) {
      if (siblingScopes.length >= MAX_BRIDGE_ENTRIES) break;
      const hashes = index.byScope[scope] ?? [];
      siblingScopes.push({ scope, commitCount: hashes.length });
    }
  }

  if (decisions.length === 0 && siblingScopes.length === 0) return null;
  return { decisions, siblingScopes };
};

// ---------------------------------------------------------------------------
// Output Formatting
// ---------------------------------------------------------------------------

const formatBridgeContext = (ctx: BridgeContext): string => {
  const lines: string[] = [];

  if (ctx.decisions.length > 0) {
    lines.push("Related decided-against entries in this scope:");
    for (const d of ctx.decisions) {
      const scopeLabel = d.scope.length > 0
        ? `[${d.scope.join(", ")}] `
        : "";
      lines.push(`  - ${scopeLabel}${d.text}`);
    }
  }

  if (ctx.siblingScopes.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Sibling scopes with same intent:");
    for (const s of ctx.siblingScopes) {
      lines.push(`  - ${s.scope} (${s.commitCount} commit${s.commitCount === 1 ? "" : "s"})`);
    }
  }

  return `<git-memory-bridge>\n${lines.join("\n")}\n</git-memory-bridge>`;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const input = await readHookInput();
  if (!input) return;

  // Only process Bash tool calls
  if (input.tool_name !== "Bash") return;

  const command = input.tool_input?.command;
  if (!command) return;

  // Parse for query command
  const query = parseQueryCommand(command);
  if (!query) return;

  // Load trailer index
  const indexResult = await loadIndex();
  if (!indexResult.ok || !indexResult.value) return;

  // Generate heuristic bridge context
  const ctx = generateBridgeContext(indexResult.value, query);
  if (!ctx) return;

  const heuristicOutput = formatBridgeContext(ctx);

  // Try LLM-enhanced summarization
  const config = await loadRlmConfig();
  if (config.enabled) {
    const queryResults = input.tool_response?.stdout ?? "";

    // Format heuristic sections for the LLM
    const relatedDecisions = ctx.decisions
      .map((d) => {
        const scopeLabel = d.scope.length > 0 ? `[${d.scope.join(", ")}] ` : "";
        return `${scopeLabel}${d.text}`;
      })
      .join("\n");

    const siblingScopes = ctx.siblingScopes
      .map((s) => `${s.scope} (${s.commitCount} commits)`)
      .join("\n");

    const llmResult = await analyzeBridgeContext(
      config,
      command,
      queryResults,
      relatedDecisions,
      siblingScopes,
    );

    if (llmResult.ok) {
      console.log(`<git-memory-bridge mode="llm-enhanced">\n${llmResult.value}\n</git-memory-bridge>`);
      return;
    }
  }

  // Fall back to heuristic output
  console.log(heuristicOutput);
};

if (import.meta.main) {
  main();
}
