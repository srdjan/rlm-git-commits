/**
 * Configuration for local LLM recursive sub-calls.
 *
 * Stored at `.git/info/rlm-config.json` (local, not committed).
 * When enabled, hooks use a locally-run model (Ollama) for smart
 * prompt analysis, recursive follow-up queries, and bridge summarization.
 *
 * Default: disabled. Keyword mode remains the fallback.
 */

import { Result } from "../types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RlmConfig {
  readonly version: 1;
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxTokens: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: RlmConfig = {
  version: 1,
  enabled: false,
  endpoint: "http://localhost:11434",
  model: "qwen2.5:7b",
  timeoutMs: 5000,
  maxTokens: 256,
};

// ---------------------------------------------------------------------------
// Git Dir Resolution
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

export const getConfigPath = async (): Promise<Result<string>> => {
  const gitDirResult = await getGitDir();
  if (!gitDirResult.ok) return gitDirResult;
  return Result.ok(`${gitDirResult.value}/info/rlm-config.json`);
};

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export const loadRlmConfig = async (): Promise<RlmConfig> => {
  const pathResult = await getConfigPath();
  if (!pathResult.ok) return DEFAULT_CONFIG;

  try {
    const content = await Deno.readTextFile(pathResult.value);
    const data = JSON.parse(content) as Record<string, unknown>;

    if (data.version !== 1) return DEFAULT_CONFIG;

    return {
      version: 1,
      enabled: typeof data.enabled === "boolean" ? data.enabled : DEFAULT_CONFIG.enabled,
      endpoint: typeof data.endpoint === "string" ? data.endpoint : DEFAULT_CONFIG.endpoint,
      model: typeof data.model === "string" ? data.model : DEFAULT_CONFIG.model,
      timeoutMs: typeof data.timeoutMs === "number" ? data.timeoutMs : DEFAULT_CONFIG.timeoutMs,
      maxTokens: typeof data.maxTokens === "number" ? data.maxTokens : DEFAULT_CONFIG.maxTokens,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
};

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export const saveRlmConfig = async (
  config: RlmConfig,
): Promise<Result<void>> => {
  const pathResult = await getConfigPath();
  if (!pathResult.ok) return pathResult as Result<never>;

  try {
    await Deno.writeTextFile(
      pathResult.value,
      JSON.stringify(config, null, 2),
    );
    return Result.ok(undefined);
  } catch (e) {
    return Result.fail(e as Error);
  }
};
