import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";
import {
  CLAUDE_MD_SECTION_TAGS,
  copyScripts,
  extractSections,
  install,
  isRlmHook,
  mergeDenoJson,
  mergeHooks,
  parseFlags,
  RLM_TASK_KEYS,
  RLM_TASKS,
  SCRIPT_MANIFEST,
  uninstallClaudeMd,
  uninstallDenoJson,
  uninstallHooks,
  uninstallScripts,
  updateClaudeMd,
} from "./install-rlm.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp directory that is a git repo. */
const makeTempGitRepo = async (): Promise<string> => {
  const dir = await Deno.makeTempDir({ prefix: "rlm-test-" });
  const cmd = new Deno.Command("git", {
    args: ["init", dir],
    stdout: "piped",
    stderr: "piped",
  });
  await cmd.output();
  return dir;
};

/** Resolve the source project root (parent of scripts/). */
const sourceDir = (): string => {
  const scriptDir = new URL(".", import.meta.url).pathname;
  return scriptDir.replace(/\/scripts\/$/, "");
};

const readJson = async (path: string): Promise<Record<string, unknown>> => {
  const content = await Deno.readTextFile(path);
  return JSON.parse(content) as Record<string, unknown>;
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// parseFlags
// ---------------------------------------------------------------------------

Deno.test("parseFlags: valid target", () => {
  const result = parseFlags(["--target=/tmp/foo"]);
  assert(result.ok);
  assertEquals(result.value.target, "/tmp/foo");
  assertEquals(result.value.dryRun, false);
  assertEquals(result.value.uninstall, false);
  assertEquals(result.value.skipHooks, false);
});

Deno.test("parseFlags: all flags set", () => {
  const result = parseFlags([
    "--target=/tmp/foo",
    "--dry-run",
    "--uninstall",
    "--skip-hooks",
  ]);
  assert(result.ok);
  assertEquals(result.value.dryRun, true);
  assertEquals(result.value.uninstall, true);
  assertEquals(result.value.skipHooks, true);
});

Deno.test("parseFlags: missing target fails", () => {
  const result = parseFlags(["--dry-run"]);
  assert(!result.ok);
  assertEquals(result.error.tag, "missing-target-flag");
});

Deno.test("parseFlags: relative target resolved to absolute", () => {
  const result = parseFlags(["--target=some/relative/path"]);
  assert(result.ok);
  assert(result.value.target.startsWith("/"));
});

// ---------------------------------------------------------------------------
// isRlmHook
// ---------------------------------------------------------------------------

Deno.test("isRlmHook: detects RLM hook", () => {
  const entry = {
    hooks: [
      {
        type: "command",
        command:
          "deno run --allow-run --allow-read scripts/git-memory-context.ts",
      },
    ],
  };
  assertEquals(isRlmHook(entry), true);
});

Deno.test("isRlmHook: rejects non-RLM hook", () => {
  const entry = {
    hooks: [{ type: "command", command: "echo hello" }],
  };
  assertEquals(isRlmHook(entry), false);
});

Deno.test("isRlmHook: rejects entry without hooks array", () => {
  assertEquals(isRlmHook({ something: "else" }), false);
});

// ---------------------------------------------------------------------------
// extractSections
// ---------------------------------------------------------------------------

Deno.test("extractSections: extracts all 5 tags from CLAUDE.md", () => {
  const src = sourceDir();
  const content = Deno.readTextFileSync(`${src}/CLAUDE.md`);
  const sections = extractSections(content);
  assertEquals(sections.size, 5);
  for (const tag of CLAUDE_MD_SECTION_TAGS) {
    assert(sections.has(tag), `Missing section: ${tag}`);
  }
});

Deno.test("extractSections: empty content returns empty map", () => {
  assertEquals(extractSections("").size, 0);
});

// ---------------------------------------------------------------------------
// Phase 1: Copy Scripts - Integration
// ---------------------------------------------------------------------------

Deno.test("copyScripts: copies all manifest files", async () => {
  const target = await makeTempGitRepo();
  try {
    const result = await copyScripts(sourceDir(), target, false);
    assert(result.ok);
    assertEquals(result.value, SCRIPT_MANIFEST.length);

    for (const file of SCRIPT_MANIFEST) {
      assert(
        await fileExists(`${target}/${file}`),
        `Missing: ${file}`,
      );
    }
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("copyScripts: dry run copies nothing", async () => {
  const target = await makeTempGitRepo();
  try {
    const result = await copyScripts(sourceDir(), target, true);
    assert(result.ok);
    assertEquals(await fileExists(`${target}/scripts/types.ts`), false);
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("uninstallScripts: removes manifest files", async () => {
  const target = await makeTempGitRepo();
  try {
    // Install first
    await copyScripts(sourceDir(), target, false);

    // Add a non-RLM file in scripts/
    await Deno.writeTextFile(`${target}/scripts/custom.ts`, "// custom");

    const result = await uninstallScripts(target, false);
    assert(result.ok);
    assertEquals(result.value, SCRIPT_MANIFEST.length);

    // Manifest files gone
    for (const file of SCRIPT_MANIFEST) {
      assertEquals(
        await fileExists(`${target}/${file}`),
        false,
        `Should be removed: ${file}`,
      );
    }

    // Custom file preserved
    assert(await fileExists(`${target}/scripts/custom.ts`));
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Phase 2: Merge Hooks - Integration
// ---------------------------------------------------------------------------

Deno.test("mergeHooks: creates settings.json from scratch", async () => {
  const target = await makeTempGitRepo();
  try {
    const result = await mergeHooks(target, false);
    assert(result.ok);

    const settings = await readJson(`${target}/.claude/settings.json`);
    const hooks = settings.hooks as Record<string, unknown[]>;
    assert(hooks.UserPromptSubmit);
    assert(hooks.PostToolUse);
    assert(hooks.Stop);
    assertEquals(hooks.UserPromptSubmit.length, 1);
    assertEquals(hooks.PostToolUse.length, 1);
    assertEquals(hooks.Stop.length, 1);
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("mergeHooks: preserves existing non-RLM hooks", async () => {
  const target = await makeTempGitRepo();
  try {
    // Create existing settings with a custom hook
    await Deno.mkdir(`${target}/.claude`, { recursive: true });
    await Deno.writeTextFile(
      `${target}/.claude/settings.json`,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "echo custom-hook" }] },
          ],
        },
      }),
    );

    const result = await mergeHooks(target, false);
    assert(result.ok);

    const settings = await readJson(`${target}/.claude/settings.json`);
    const hooks = settings.hooks as Record<string, unknown[]>;

    // Custom hook preserved + RLM hook added
    assertEquals(hooks.UserPromptSubmit.length, 2);
    assertEquals(hooks.PostToolUse.length, 1);
    assertEquals(hooks.Stop.length, 1);
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("mergeHooks: replaces existing RLM hooks on upgrade", async () => {
  const target = await makeTempGitRepo();
  try {
    // Install once
    await mergeHooks(target, false);
    // Install again (upgrade)
    await mergeHooks(target, false);

    const settings = await readJson(`${target}/.claude/settings.json`);
    const hooks = settings.hooks as Record<string, unknown[]>;

    // Should not duplicate - still 1 per event type
    assertEquals(hooks.UserPromptSubmit.length, 1);
    assertEquals(hooks.PostToolUse.length, 1);
    assertEquals(hooks.Stop.length, 1);
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("uninstallHooks: removes only RLM hooks", async () => {
  const target = await makeTempGitRepo();
  try {
    // Create settings with custom + RLM hooks
    await Deno.mkdir(`${target}/.claude`, { recursive: true });
    await Deno.writeTextFile(
      `${target}/.claude/settings.json`,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "echo custom" }] },
          ],
        },
      }),
    );
    await mergeHooks(target, false);

    // Now uninstall
    const result = await uninstallHooks(target, false);
    assert(result.ok);

    const settings = await readJson(`${target}/.claude/settings.json`);
    const hooks = settings.hooks as Record<string, unknown[]>;

    // Custom hook preserved, RLM-only events removed
    assertEquals(hooks.UserPromptSubmit.length, 1);
    assertEquals(hooks.PostToolUse, undefined);
    assertEquals(hooks.Stop, undefined);
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Phase 3: CLAUDE.md - Integration
// ---------------------------------------------------------------------------

Deno.test("updateClaudeMd: creates CLAUDE.md from scratch", async () => {
  const target = await makeTempGitRepo();
  try {
    const result = await updateClaudeMd(sourceDir(), target, false);
    assert(result.ok);

    const content = await Deno.readTextFile(`${target}/CLAUDE.md`);
    for (const tag of CLAUDE_MD_SECTION_TAGS) {
      assert(content.includes(`<${tag}>`), `Missing tag: <${tag}>`);
      assert(content.includes(`</${tag}>`), `Missing closing tag: </${tag}>`);
    }
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("updateClaudeMd: preserves existing content", async () => {
  const target = await makeTempGitRepo();
  try {
    // Create existing CLAUDE.md with custom content
    await Deno.writeTextFile(
      `${target}/CLAUDE.md`,
      "# My Project\n\nCustom instructions here.\n",
    );

    const result = await updateClaudeMd(sourceDir(), target, false);
    assert(result.ok);

    const content = await Deno.readTextFile(`${target}/CLAUDE.md`);
    assert(content.includes("# My Project"));
    assert(content.includes("Custom instructions here."));
    assert(content.includes("<git-memory>"));
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("updateClaudeMd: replaces existing sections on upgrade", async () => {
  const target = await makeTempGitRepo();
  try {
    // Install once
    await updateClaudeMd(sourceDir(), target, false);
    const before = await Deno.readTextFile(`${target}/CLAUDE.md`);
    const beforeCount = (before.match(/<git-memory>/g) ?? []).length;
    assertEquals(beforeCount, 1);

    // Install again (upgrade)
    await updateClaudeMd(sourceDir(), target, false);
    const after = await Deno.readTextFile(`${target}/CLAUDE.md`);
    const afterCount = (after.match(/<git-memory>/g) ?? []).length;
    assertEquals(afterCount, 1);
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("uninstallClaudeMd: removes RLM sections, preserves rest", async () => {
  const target = await makeTempGitRepo();
  try {
    await Deno.writeTextFile(
      `${target}/CLAUDE.md`,
      "# My Project\n\nKeep this.\n",
    );
    await updateClaudeMd(sourceDir(), target, false);

    const result = await uninstallClaudeMd(target, false);
    assert(result.ok);

    const content = await Deno.readTextFile(`${target}/CLAUDE.md`);
    assert(content.includes("# My Project"));
    assert(content.includes("Keep this."));
    for (const tag of CLAUDE_MD_SECTION_TAGS) {
      assertEquals(content.includes(`<${tag}>`), false, `Should be removed: <${tag}>`);
    }
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("uninstallClaudeMd: deletes file if only RLM content", async () => {
  const target = await makeTempGitRepo();
  try {
    await updateClaudeMd(sourceDir(), target, false);
    assert(await fileExists(`${target}/CLAUDE.md`));

    await uninstallClaudeMd(target, false);
    assertEquals(await fileExists(`${target}/CLAUDE.md`), false);
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Phase 4: deno.json - Integration
// ---------------------------------------------------------------------------

Deno.test("mergeDenoJson: creates deno.json from scratch", async () => {
  const target = await makeTempGitRepo();
  try {
    const result = await mergeDenoJson(target, false);
    assert(result.ok);

    const config = await readJson(`${target}/deno.json`);
    const tasks = config.tasks as Record<string, string>;
    for (const key of RLM_TASK_KEYS) {
      assertEquals(tasks[key], RLM_TASKS[key], `Missing task: ${key}`);
    }
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("mergeDenoJson: preserves existing tasks", async () => {
  const target = await makeTempGitRepo();
  try {
    await Deno.writeTextFile(
      `${target}/deno.json`,
      JSON.stringify({ tasks: { test: "deno test", build: "deno compile" } }),
    );

    const result = await mergeDenoJson(target, false);
    assert(result.ok);

    const config = await readJson(`${target}/deno.json`);
    const tasks = config.tasks as Record<string, string>;
    assertEquals(tasks.test, "deno test");
    assertEquals(tasks.build, "deno compile");
    assertEquals(tasks.context, RLM_TASKS.context);
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("uninstallDenoJson: removes only RLM tasks", async () => {
  const target = await makeTempGitRepo();
  try {
    await Deno.writeTextFile(
      `${target}/deno.json`,
      JSON.stringify({ tasks: { test: "deno test", build: "deno compile" } }),
    );
    await mergeDenoJson(target, false);

    const result = await uninstallDenoJson(target, false);
    assert(result.ok);

    const config = await readJson(`${target}/deno.json`);
    const tasks = config.tasks as Record<string, string>;
    assertEquals(tasks.test, "deno test");
    assertEquals(tasks.build, "deno compile");
    for (const key of RLM_TASK_KEYS) {
      assertEquals(tasks[key], undefined, `Should be removed: ${key}`);
    }
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Full integration: install() entry point
// ---------------------------------------------------------------------------

Deno.test("install: fresh install into empty git repo", async () => {
  const target = await makeTempGitRepo();
  try {
    const result = await install([`--target=${target}`]);
    assert(result.ok);

    // Scripts exist
    for (const file of SCRIPT_MANIFEST) {
      assert(await fileExists(`${target}/${file}`), `Missing: ${file}`);
    }

    // Hooks exist
    const settings = await readJson(`${target}/.claude/settings.json`);
    const hooks = settings.hooks as Record<string, unknown[]>;
    assert(hooks.UserPromptSubmit);

    // CLAUDE.md sections exist
    const claude = await Deno.readTextFile(`${target}/CLAUDE.md`);
    assert(claude.includes("<git-memory>"));

    // deno.json tasks exist
    const config = await readJson(`${target}/deno.json`);
    const tasks = config.tasks as Record<string, string>;
    assert(tasks.context);
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("install: idempotent - running twice succeeds cleanly", async () => {
  const target = await makeTempGitRepo();
  try {
    const first = await install([`--target=${target}`]);
    assert(first.ok);

    const second = await install([`--target=${target}`]);
    assert(second.ok);

    // Still exactly 1 RLM hook per event
    const settings = await readJson(`${target}/.claude/settings.json`);
    const hooks = settings.hooks as Record<string, unknown[]>;
    assertEquals(hooks.UserPromptSubmit.length, 1);

    // Still exactly 1 of each section
    const claude = await Deno.readTextFile(`${target}/CLAUDE.md`);
    assertEquals((claude.match(/<git-memory>/g) ?? []).length, 1);
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("install: uninstall removes RLM artifacts", async () => {
  const target = await makeTempGitRepo();
  try {
    // Add custom content first
    await Deno.writeTextFile(`${target}/CLAUDE.md`, "# Keep me\n");
    await Deno.writeTextFile(
      `${target}/deno.json`,
      JSON.stringify({ tasks: { test: "deno test" } }),
    );
    await Deno.mkdir(`${target}/.claude`, { recursive: true });
    await Deno.writeTextFile(
      `${target}/.claude/settings.json`,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "echo custom" }] },
          ],
        },
      }),
    );

    // Install
    const installResult = await install([`--target=${target}`]);
    assert(installResult.ok);

    // Uninstall
    const uninstallResult = await install([
      `--target=${target}`,
      "--uninstall",
    ]);
    assert(uninstallResult.ok);

    // Scripts removed
    for (const file of SCRIPT_MANIFEST) {
      assertEquals(
        await fileExists(`${target}/${file}`),
        false,
        `Should be removed: ${file}`,
      );
    }

    // CLAUDE.md preserves custom content, no RLM sections
    const claude = await Deno.readTextFile(`${target}/CLAUDE.md`);
    assert(claude.includes("# Keep me"));
    assertEquals(claude.includes("<git-memory>"), false);

    // deno.json preserves custom tasks
    const config = await readJson(`${target}/deno.json`);
    const tasks = config.tasks as Record<string, string>;
    assertEquals(tasks.test, "deno test");
    assertEquals(tasks.context, undefined);

    // settings.json preserves custom hook
    const settings = await readJson(`${target}/.claude/settings.json`);
    const hooks = settings.hooks as Record<string, unknown[]>;
    assertEquals(hooks.UserPromptSubmit.length, 1);
    assertEquals(hooks.PostToolUse, undefined);
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("install: dry-run modifies nothing", async () => {
  const target = await makeTempGitRepo();
  try {
    const result = await install([`--target=${target}`, "--dry-run"]);
    assert(result.ok);

    // No artifacts created
    assertEquals(await fileExists(`${target}/scripts`), false);
    assertEquals(await fileExists(`${target}/.claude`), false);
    assertEquals(await fileExists(`${target}/CLAUDE.md`), false);
    assertEquals(await fileExists(`${target}/deno.json`), false);
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("install: skip-hooks omits settings.json", async () => {
  const target = await makeTempGitRepo();
  try {
    const result = await install([`--target=${target}`, "--skip-hooks"]);
    assert(result.ok);

    // Scripts and CLAUDE.md exist, but no settings.json
    assert(await fileExists(`${target}/scripts/types.ts`));
    assert(await fileExists(`${target}/CLAUDE.md`));
    assertEquals(await fileExists(`${target}/.claude/settings.json`), false);
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("install: non-git-repo fails", async () => {
  const target = await Deno.makeTempDir({ prefix: "rlm-test-nogit-" });
  try {
    const result = await install([`--target=${target}`]);
    assert(!result.ok);
    assertEquals(result.error.tag, "not-git-repo");
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("install: missing target fails", async () => {
  const result = await install(["--target=/tmp/rlm-nonexistent-dir-12345"]);
  assert(!result.ok);
  assertEquals(result.error.tag, "target-not-found");
});

Deno.test("install: missing target flag fails", async () => {
  const result = await install(["--dry-run"]);
  assert(!result.ok);
  assertEquals(result.error.tag, "missing-target-flag");
});
