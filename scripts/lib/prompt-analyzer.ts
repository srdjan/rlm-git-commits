/**
 * Pure functions for extracting search signals from user prompts.
 *
 * Given a prompt like "fix the auth login bug", extracts:
 *   - scopeHints: tokens that match trailer index scope keys ("auth")
 *   - intentHints: tokens that map to IntentType via synonym table ("fix-defect")
 *   - keywords: remaining significant tokens for decided-against matching ("login")
 *
 * Used by the UserPromptSubmit hook to produce prompt-aware context
 * instead of always dumping the same recent commits.
 */

import type { IntentType } from "../types.ts";
import { scopeMatches } from "./matching.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptSignals {
  readonly scopeHints: readonly string[];
  readonly intentHints: readonly IntentType[];
  readonly keywords: readonly string[];
}

// ---------------------------------------------------------------------------
// Intent Synonym Table
// ---------------------------------------------------------------------------

const INTENT_SYNONYMS: ReadonlyMap<string, IntentType> = new Map([
  // fix-defect
  ["fix", "fix-defect"],
  ["bug", "fix-defect"],
  ["broken", "fix-defect"],
  ["crash", "fix-defect"],
  ["error", "fix-defect"],
  ["issue", "fix-defect"],
  ["debug", "fix-defect"],
  ["regression", "fix-defect"],
  ["patch", "fix-defect"],
  // enable-capability
  ["add", "enable-capability"],
  ["feature", "enable-capability"],
  ["implement", "enable-capability"],
  ["create", "enable-capability"],
  ["new", "enable-capability"],
  ["support", "enable-capability"],
  ["enable", "enable-capability"],
  // restructure
  ["refactor", "restructure"],
  ["restructure", "restructure"],
  ["reorganize", "restructure"],
  ["rename", "restructure"],
  ["move", "restructure"],
  ["extract", "restructure"],
  ["simplify", "restructure"],
  ["cleanup", "restructure"],
  // improve-quality
  ["improve", "improve-quality"],
  ["optimize", "improve-quality"],
  ["performance", "improve-quality"],
  ["perf", "improve-quality"],
  ["faster", "improve-quality"],
  ["speed", "improve-quality"],
  ["quality", "improve-quality"],
  // document
  ["document", "document"],
  ["docs", "document"],
  ["readme", "document"],
  ["comment", "document"],
  ["guide", "document"],
  // configure-infra
  ["config", "configure-infra"],
  ["configure", "configure-infra"],
  ["ci", "configure-infra"],
  ["deploy", "configure-infra"],
  ["build", "configure-infra"],
  ["infra", "configure-infra"],
  ["pipeline", "configure-infra"],
  // explore
  ["explore", "explore"],
  ["investigate", "explore"],
  ["research", "explore"],
  ["prototype", "explore"],
  ["spike", "explore"],
  // resolve-blocker
  ["blocker", "resolve-blocker"],
  ["blocked", "resolve-blocker"],
  ["unblock", "resolve-blocker"],
  ["workaround", "resolve-blocker"],
]);

// ---------------------------------------------------------------------------
// Stop Words
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must",
  "i", "me", "my", "we", "our", "you", "your", "it", "its",
  "he", "she", "they", "them", "their", "this", "that", "these", "those",
  "in", "on", "at", "to", "for", "of", "with", "by", "from", "up",
  "about", "into", "through", "during", "before", "after",
  "and", "but", "or", "not", "no", "if", "then", "so", "too",
  "what", "which", "who", "when", "where", "how", "why",
  "all", "each", "every", "both", "some", "any", "most",
  "also", "just", "only", "very", "still", "already", "now",
  "here", "there", "out", "get", "make", "like", "use",
]);

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const tokenize = (prompt: string): readonly string[] =>
  prompt
    .toLowerCase()
    .replace(/[^a-z0-9/\-_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

// ---------------------------------------------------------------------------
// Main Extraction
// ---------------------------------------------------------------------------

/**
 * Extract search signals from a user prompt by matching tokens
 * against known scope keys and intent synonyms.
 *
 * Performance: O(tokens * scopeKeys) - sub-millisecond for typical inputs.
 */
export const extractPromptSignals = (
  prompt: string,
  scopeKeys: readonly string[],
): PromptSignals => {
  if (!prompt.trim()) {
    return { scopeHints: [], intentHints: [], keywords: [] };
  }

  const tokens = tokenize(prompt);
  const scopeHints = new Set<string>();
  const intentHints = new Set<IntentType>();
  const consumedTokens = new Set<string>();

  // Match tokens against scope keys
  for (const token of tokens) {
    for (const scopeKey of scopeKeys) {
      // Token matches if it equals or is a prefix of a scope key segment
      if (scopeMatches(scopeKey, token)) {
        scopeHints.add(token);
        consumedTokens.add(token);
        break;
      }
    }
  }

  // Match tokens against intent synonyms
  for (const token of tokens) {
    const intent = INTENT_SYNONYMS.get(token);
    if (intent) {
      intentHints.add(intent);
      consumedTokens.add(token);
    }
  }

  // Remaining significant tokens become keywords
  const keywords = tokens.filter(
    (t) => !consumedTokens.has(t) && !STOP_WORDS.has(t),
  );

  // Deduplicate keywords
  const uniqueKeywords = [...new Set(keywords)];

  return {
    scopeHints: [...scopeHints],
    intentHints: [...intentHints],
    keywords: uniqueKeywords,
  };
};
