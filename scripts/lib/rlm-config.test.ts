import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";
import {
  DEFAULT_CONFIG,
  DEFAULT_REPL_CONFIG,
  getConfigPath,
  loadRlmConfig,
  saveRlmConfig,
  type RlmConfig,
} from "./rlm-config.ts";

// ---------------------------------------------------------------------------
// loadRlmConfig: defaults when file missing
// ---------------------------------------------------------------------------

Deno.test("loadRlmConfig: returns defaults when file is missing", async () => {
  // Ensure no config file exists
  const pathResult = await getConfigPath();
  assert(pathResult.ok);
  if (pathResult.ok) {
    try {
      await Deno.remove(pathResult.value);
    } catch {
      // already gone
    }
  }

  const config = await loadRlmConfig();
  assertEquals(config, DEFAULT_CONFIG);
  assertEquals(config.enabled, false);
  assertEquals(config.endpoint, "http://localhost:11434");
  assertEquals(config.model, "qwen2.5:7b");
  assertEquals(config.timeoutMs, 5000);
  assertEquals(config.maxTokens, 256);
});

// ---------------------------------------------------------------------------
// Round-trip save/load
// ---------------------------------------------------------------------------

Deno.test("loadRlmConfig: round-trip save and load preserves config", async () => {
  const custom: RlmConfig = {
    version: 1,
    enabled: true,
    endpoint: "http://localhost:8080",
    model: "llama3.2:3b",
    timeoutMs: 3000,
    maxTokens: 512,
    ...DEFAULT_REPL_CONFIG,
  };

  const saveResult = await saveRlmConfig(custom);
  assert(saveResult.ok);

  const loaded = await loadRlmConfig();
  assertEquals(loaded, custom);

  // Cleanup
  const pathResult = await getConfigPath();
  if (pathResult.ok) {
    try {
      await Deno.remove(pathResult.value);
    } catch {
      // ignore
    }
  }
});

// ---------------------------------------------------------------------------
// Invalid JSON returns defaults
// ---------------------------------------------------------------------------

Deno.test("loadRlmConfig: invalid JSON returns defaults", async () => {
  const pathResult = await getConfigPath();
  assert(pathResult.ok);
  if (pathResult.ok) {
    await Deno.writeTextFile(pathResult.value, "not valid json{{{");
  }

  const config = await loadRlmConfig();
  assertEquals(config, DEFAULT_CONFIG);

  // Cleanup
  if (pathResult.ok) {
    try {
      await Deno.remove(pathResult.value);
    } catch {
      // ignore
    }
  }
});

// ---------------------------------------------------------------------------
// Wrong version returns defaults
// ---------------------------------------------------------------------------

Deno.test("loadRlmConfig: wrong version returns defaults", async () => {
  const pathResult = await getConfigPath();
  assert(pathResult.ok);
  if (pathResult.ok) {
    await Deno.writeTextFile(
      pathResult.value,
      JSON.stringify({ version: 99, enabled: true }),
    );
  }

  const config = await loadRlmConfig();
  assertEquals(config, DEFAULT_CONFIG);

  // Cleanup
  if (pathResult.ok) {
    try {
      await Deno.remove(pathResult.value);
    } catch {
      // ignore
    }
  }
});

// ---------------------------------------------------------------------------
// Partial config fills defaults for missing fields
// ---------------------------------------------------------------------------

Deno.test("loadRlmConfig: partial config fills defaults", async () => {
  const pathResult = await getConfigPath();
  assert(pathResult.ok);
  if (pathResult.ok) {
    await Deno.writeTextFile(
      pathResult.value,
      JSON.stringify({ version: 1, enabled: true }),
    );
  }

  const config = await loadRlmConfig();
  assertEquals(config.enabled, true);
  assertEquals(config.endpoint, DEFAULT_CONFIG.endpoint);
  assertEquals(config.model, DEFAULT_CONFIG.model);

  // Cleanup
  if (pathResult.ok) {
    try {
      await Deno.remove(pathResult.value);
    } catch {
      // ignore
    }
  }
});

// ---------------------------------------------------------------------------
// REPL fields: v1 config without REPL fields gets defaults
// ---------------------------------------------------------------------------

Deno.test("loadRlmConfig: v1 config without REPL fields fills defaults", async () => {
  const pathResult = await getConfigPath();
  assert(pathResult.ok);
  if (pathResult.ok) {
    await Deno.writeTextFile(
      pathResult.value,
      JSON.stringify({ version: 1, enabled: true, model: "test" }),
    );
  }

  const config = await loadRlmConfig();
  assertEquals(config.replEnabled, false);
  assertEquals(config.replMaxIterations, 6);
  assertEquals(config.replMaxLlmCalls, 10);
  assertEquals(config.replTimeoutBudgetMs, 15000);
  assertEquals(config.replMaxOutputTokens, 512);

  // Cleanup
  if (pathResult.ok) {
    try { await Deno.remove(pathResult.value); } catch { /* ignore */ }
  }
});

Deno.test("loadRlmConfig: round-trip preserves REPL fields", async () => {
  const custom: RlmConfig = {
    ...DEFAULT_CONFIG,
    replEnabled: true,
    replMaxIterations: 3,
    replMaxLlmCalls: 5,
    replTimeoutBudgetMs: 8000,
    replMaxOutputTokens: 256,
  };

  const saveResult = await saveRlmConfig(custom);
  assert(saveResult.ok);

  const loaded = await loadRlmConfig();
  assertEquals(loaded.replEnabled, true);
  assertEquals(loaded.replMaxIterations, 3);
  assertEquals(loaded.replMaxLlmCalls, 5);
  assertEquals(loaded.replTimeoutBudgetMs, 8000);
  assertEquals(loaded.replMaxOutputTokens, 256);

  // Cleanup
  const pathResult = await getConfigPath();
  if (pathResult.ok) {
    try { await Deno.remove(pathResult.value); } catch { /* ignore */ }
  }
});
