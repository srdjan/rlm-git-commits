/**
 * Pure extraction of executable JavaScript from LLM chat responses.
 *
 * Handles fenced code blocks (```js, ```javascript, bare ```)
 * and the absence of fences (treated as a final text answer).
 */

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract the first fenced code block from an LLM response.
 * Returns null when no code block is found — the caller should
 * treat the entire response as a final text answer.
 */
export const extractCodeBlock = (response: string): string | null => {
  const openPattern = /^```(?:js|javascript)?\s*$/m;
  const openMatch = openPattern.exec(response);
  if (!openMatch) return null;

  const codeStart = openMatch.index + openMatch[0].length;
  const rest = response.slice(codeStart);

  // Look for closing fence — if absent, treat remainder as code
  const closeIdx = rest.indexOf("\n```");
  const code = closeIdx >= 0 ? rest.slice(0, closeIdx) : rest;

  const trimmed = code.trim();
  return trimmed.length > 0 ? trimmed : null;
};
