/**
 * Pure parser for extracting query parameters from deno task parse commands.
 *
 * Used by the PostToolUse bridge hook to detect git queries and determine
 * what related context to surface. Returns null for non-query commands.
 */

import type { IntentType } from "../types.ts";
import { isIntentType } from "./parser.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedQueryCommand {
  readonly scope: string | null;
  readonly intents: readonly IntentType[];
  readonly session: string | null;
  readonly decidedAgainst: string | null;
  readonly decisionsOnly: boolean;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

const PARSE_COMMAND_RE = /deno\s+task\s+parse\b/;

// ---------------------------------------------------------------------------
// Main Parser
// ---------------------------------------------------------------------------

/**
 * Extract query parameters from a Bash command string.
 *
 * Returns null for any command that is not a `deno task parse` invocation.
 * For recognized commands, extracts --scope, --intent, --session,
 * --decided-against, and --decisions-only flags.
 */
export const parseQueryCommand = (
  command: string,
): ParsedQueryCommand | null => {
  if (!PARSE_COMMAND_RE.test(command)) return null;

  const getFlag = (flag: string): string | null => {
    const re = new RegExp(`--${flag}=([^\\s]+)`);
    const match = re.exec(command);
    return match ? match[1] : null;
  };

  const getAllFlags = (flag: string): string[] => {
    const re = new RegExp(`--${flag}=([^\\s]+)`, "g");
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(command)) !== null) {
      matches.push(m[1]);
    }
    return matches;
  };

  const scope = getFlag("scope");
  const intents = getAllFlags("intent").filter(isIntentType) as IntentType[];
  const session = getFlag("session");
  const decidedAgainst = getFlag("decided-against");
  const decisionsOnly = command.includes("--decisions-only");

  return { scope, intents, session, decidedAgainst, decisionsOnly };
};
