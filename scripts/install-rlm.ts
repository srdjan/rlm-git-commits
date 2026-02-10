/**
 * RLM Install Script
 *
 * Installs the Read-Log-Memory (RLM) system into a target project.
 * Copies scripts, merges hooks into .claude/settings.json, injects
 * CLAUDE.md instruction sections, and adds deno.json tasks.
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-run scripts/install-rlm.ts [options]
 *
 * Options:
 *   --target=<path>  (required) Path to target project root (must be a git repo)
 *   --dry-run        Print what would be done, modify nothing
 *   --uninstall      Remove RLM artifacts from target
 *   --skip-hooks     Skip .claude/settings.json modification
 */

import { Result } from "./types.ts";

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

type InstallErrorTag =
  | "not-git-repo"
  | "no-deno"
  | "target-not-found"
  | "read-failed"
  | "write-failed"
  | "parse-failed"
  | "missing-target-flag";

interface InstallError {
  readonly tag: InstallErrorTag;
  readonly message: string;
}

const fail = (tag: InstallErrorTag, message: string): Result<never, InstallError> =>
  Result.fail({ tag, message });

// ---------------------------------------------------------------------------
// Script Manifest
// ---------------------------------------------------------------------------

const SCRIPT_MANIFEST = [
  "scripts/types.ts",
  "scripts/build-trailer-index.ts",
  "scripts/git-memory-context.ts",
  "scripts/git-memory-bridge.ts",
  "scripts/git-memory-consolidate.ts",
  "scripts/working-memory-write.ts",
  "scripts/rlm-configure.ts",
  "scripts/lib/parser.ts",
  "scripts/lib/matching.ts",
  "scripts/lib/prompt-analyzer.ts",
  "scripts/lib/working-memory.ts",
  "scripts/lib/command-parser.ts",
  "scripts/lib/consolidation.ts",
  "scripts/lib/rlm-config.ts",
  "scripts/lib/local-llm.ts",
  "scripts/lib/rlm-subcalls.ts",
] as const;

// ---------------------------------------------------------------------------
// Hook Definitions
// ---------------------------------------------------------------------------

const RLM_HOOKS = {
  UserPromptSubmit: [
    {
      hooks: [
        {
          type: "command",
          command:
            "deno run --allow-run --allow-read --allow-env --allow-net scripts/git-memory-context.ts",
        },
      ],
    },
  ],
  PostToolUse: [
    {
      matcher: "Bash",
      hooks: [
        {
          type: "command",
          command:
            "deno run --allow-run --allow-read --allow-env --allow-net scripts/git-memory-bridge.ts",
          async: true,
        },
      ],
    },
  ],
  Stop: [
    {
      hooks: [
        {
          type: "command",
          command:
            "deno run --allow-run --allow-read --allow-write --allow-env scripts/git-memory-consolidate.ts",
        },
      ],
    },
  ],
} as const;

// Script filenames used to detect RLM hooks in existing settings
const RLM_HOOK_MARKERS = [
  "git-memory-context.ts",
  "git-memory-bridge.ts",
  "git-memory-consolidate.ts",
];

// ---------------------------------------------------------------------------
// CLAUDE.md Section Tags
// ---------------------------------------------------------------------------

const CLAUDE_MD_SECTION_TAGS = [
  "git-memory",
  "working-memory",
  "git-memory-bridge",
  "memory-consolidation",
  "rlm-local-llm",
] as const;

// ---------------------------------------------------------------------------
// Deno Tasks
// ---------------------------------------------------------------------------

const RLM_TASK_KEYS = [
  "context",
  "memory:write",
  "memory:clear",
  "memory:consolidate",
  "rlm:configure",
] as const;

const RLM_TASKS: Record<string, string> = {
  context:
    "deno run --allow-run --allow-read --allow-env --allow-net scripts/git-memory-context.ts",
  "memory:write":
    "deno run --allow-run --allow-read --allow-write --allow-env scripts/working-memory-write.ts",
  "memory:clear":
    "deno run --allow-run --allow-read --allow-write scripts/working-memory-write.ts --clear",
  "memory:consolidate":
    "deno run --allow-run --allow-read --allow-write --allow-env scripts/git-memory-consolidate.ts",
  "rlm:configure":
    "deno run --allow-run --allow-read --allow-write --allow-net scripts/rlm-configure.ts",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
};

const dirExists = async (path: string): Promise<boolean> => {
  try {
    const info = await Deno.stat(path);
    return info.isDirectory;
  } catch {
    return false;
  }
};

const readTextFile = async (
  path: string,
): Promise<Result<string, InstallError>> => {
  try {
    const content = await Deno.readTextFile(path);
    return Result.ok(content);
  } catch (e) {
    return fail(
      "read-failed",
      `Failed to read ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};

const writeTextFile = async (
  path: string,
  content: string,
): Promise<Result<void, InstallError>> => {
  try {
    await Deno.writeTextFile(path, content);
    return Result.ok(undefined);
  } catch (e) {
    return fail(
      "write-failed",
      `Failed to write ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};

const parseJson = (
  content: string,
  path: string,
): Result<Record<string, unknown>, InstallError> => {
  try {
    const parsed = JSON.parse(content);
    return Result.ok(parsed as Record<string, unknown>);
  } catch (e) {
    return fail(
      "parse-failed",
      `Failed to parse JSON in ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};

const resolveSourceDir = (): string => {
  const scriptDir = new URL(".", import.meta.url).pathname;
  // scriptDir is .../scripts/, parent is the project root
  return scriptDir.replace(/\/scripts\/$/, "");
};

const isDirEmpty = async (path: string): Promise<boolean> => {
  try {
    for await (const _ of Deno.readDir(path)) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
};

// ---------------------------------------------------------------------------
// Phase 0: Prerequisites
// ---------------------------------------------------------------------------

interface Flags {
  readonly target: string;
  readonly dryRun: boolean;
  readonly uninstall: boolean;
  readonly skipHooks: boolean;
}

const parseFlags = (args: readonly string[]): Result<Flags, InstallError> => {
  const targetArg = args.find((a) => a.startsWith("--target="));
  if (!targetArg) {
    return fail(
      "missing-target-flag",
      "Missing required --target=<path> flag",
    );
  }

  const rawTarget = targetArg.slice("--target=".length);
  // Resolve to absolute path
  const target = rawTarget.startsWith("/")
    ? rawTarget
    : `${Deno.cwd()}/${rawTarget}`;

  return Result.ok({
    target,
    dryRun: args.includes("--dry-run"),
    uninstall: args.includes("--uninstall"),
    skipHooks: args.includes("--skip-hooks"),
  });
};

const validatePrerequisites = async (
  target: string,
): Promise<Result<void, InstallError>> => {
  // Check target exists
  if (!(await dirExists(target))) {
    return fail("target-not-found", `Target directory not found: ${target}`);
  }

  // Check target is a git repo
  try {
    const cmd = new Deno.Command("git", {
      args: ["-C", target, "rev-parse", "--git-dir"],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      return fail("not-git-repo", `Target is not a git repository: ${target}`);
    }
  } catch {
    return fail("not-git-repo", `Cannot run git in target: ${target}`);
  }

  // Check deno is on PATH
  try {
    const cmd = new Deno.Command("deno", {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      return fail("no-deno", "deno is not available on PATH");
    }
  } catch {
    return fail("no-deno", "deno is not available on PATH");
  }

  return Result.ok(undefined);
};

// ---------------------------------------------------------------------------
// Phase 1: Copy Scripts
// ---------------------------------------------------------------------------

const copyScripts = async (
  sourceDir: string,
  target: string,
  dryRun: boolean,
): Promise<Result<number, InstallError>> => {
  const targetScripts = `${target}/scripts`;
  const targetLib = `${target}/scripts/lib`;

  if (dryRun) {
    console.log(`  Would create directories: ${targetScripts}, ${targetLib}`);
    console.log(`  Would copy ${SCRIPT_MANIFEST.length} files`);
    return Result.ok(SCRIPT_MANIFEST.length);
  }

  await Deno.mkdir(targetLib, { recursive: true });

  let copied = 0;
  for (const file of SCRIPT_MANIFEST) {
    const src = `${sourceDir}/${file}`;
    const dst = `${target}/${file}`;

    const readResult = await readTextFile(src);
    if (!readResult.ok) return readResult;

    const writeResult = await writeTextFile(dst, readResult.value);
    if (!writeResult.ok) return writeResult;

    copied++;
  }

  return Result.ok(copied);
};

const uninstallScripts = async (
  target: string,
  dryRun: boolean,
): Promise<Result<number, InstallError>> => {
  let removed = 0;

  for (const file of SCRIPT_MANIFEST) {
    const path = `${target}/${file}`;
    if (await fileExists(path)) {
      if (dryRun) {
        console.log(`  Would remove: ${path}`);
      } else {
        try {
          await Deno.remove(path);
        } catch (e) {
          return fail(
            "write-failed",
            `Failed to remove ${path}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      removed++;
    }
  }

  // Remove directories if empty (lib first, then scripts)
  if (!dryRun) {
    const libDir = `${target}/scripts/lib`;
    if ((await dirExists(libDir)) && (await isDirEmpty(libDir))) {
      try {
        await Deno.remove(libDir);
      } catch {
        // non-fatal: directory may have other files
      }
    }
    const scriptsDir = `${target}/scripts`;
    if ((await dirExists(scriptsDir)) && (await isDirEmpty(scriptsDir))) {
      try {
        await Deno.remove(scriptsDir);
      } catch {
        // non-fatal
      }
    }
  }

  return Result.ok(removed);
};

// ---------------------------------------------------------------------------
// Phase 2: Merge .claude/settings.json
// ---------------------------------------------------------------------------

const isRlmHook = (entry: Record<string, unknown>): boolean => {
  const hooks = entry.hooks as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((h) => {
    const cmd = h.command;
    if (typeof cmd !== "string") return false;
    return RLM_HOOK_MARKERS.some((marker) => cmd.includes(marker));
  });
};

const mergeHooks = async (
  target: string,
  dryRun: boolean,
): Promise<Result<void, InstallError>> => {
  const settingsDir = `${target}/.claude`;
  const settingsPath = `${settingsDir}/settings.json`;

  let settings: Record<string, unknown> = {};

  if (await fileExists(settingsPath)) {
    const readResult = await readTextFile(settingsPath);
    if (!readResult.ok) return readResult;

    const parseResult = parseJson(readResult.value, settingsPath);
    if (!parseResult.ok) return parseResult;

    settings = parseResult.value;
  }

  const hooks = (settings.hooks ?? {}) as Record<
    string,
    Array<Record<string, unknown>>
  >;

  for (const [eventType, rlmEntries] of Object.entries(RLM_HOOKS)) {
    const existing = hooks[eventType] ?? [];

    // Remove any existing RLM hooks
    const filtered = existing.filter((entry) => !isRlmHook(entry));

    // Append RLM hooks (deep copy to avoid readonly issues)
    const rlmCopies = JSON.parse(JSON.stringify(rlmEntries)) as Array<
      Record<string, unknown>
    >;
    hooks[eventType] = [...filtered, ...rlmCopies];
  }

  settings.hooks = hooks;

  if (dryRun) {
    console.log(`  Would write: ${settingsPath}`);
    console.log(`  Hook events: ${Object.keys(RLM_HOOKS).join(", ")}`);
    return Result.ok(undefined);
  }

  await Deno.mkdir(settingsDir, { recursive: true });
  return writeTextFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
};

const uninstallHooks = async (
  target: string,
  dryRun: boolean,
): Promise<Result<void, InstallError>> => {
  const settingsPath = `${target}/.claude/settings.json`;

  if (!(await fileExists(settingsPath))) {
    return Result.ok(undefined);
  }

  const readResult = await readTextFile(settingsPath);
  if (!readResult.ok) return readResult;

  const parseResult = parseJson(readResult.value, settingsPath);
  if (!parseResult.ok) return parseResult;

  const settings = parseResult.value;
  const hooks = (settings.hooks ?? {}) as Record<
    string,
    Array<Record<string, unknown>>
  >;

  let modified = false;
  for (const eventType of Object.keys(hooks)) {
    const before = hooks[eventType].length;
    hooks[eventType] = hooks[eventType].filter((entry) => !isRlmHook(entry));
    if (hooks[eventType].length !== before) modified = true;
    if (hooks[eventType].length === 0) {
      delete hooks[eventType];
      modified = true;
    }
  }

  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = hooks;
  }

  if (!modified) return Result.ok(undefined);

  if (dryRun) {
    console.log(`  Would update: ${settingsPath} (remove RLM hooks)`);
    return Result.ok(undefined);
  }

  return writeTextFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
};

// ---------------------------------------------------------------------------
// Phase 3: Update CLAUDE.md
// ---------------------------------------------------------------------------

const extractSections = (
  content: string,
): Map<string, string> => {
  const sections = new Map<string, string>();

  for (const tag of CLAUDE_MD_SECTION_TAGS) {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    const start = content.indexOf(openTag);
    const end = content.indexOf(closeTag);
    if (start !== -1 && end !== -1) {
      sections.set(tag, content.slice(start, end + closeTag.length));
    }
  }

  return sections;
};

const updateClaudeMd = async (
  sourceDir: string,
  target: string,
  dryRun: boolean,
): Promise<Result<void, InstallError>> => {
  const sourcePath = `${sourceDir}/CLAUDE.md`;
  const targetPath = `${target}/CLAUDE.md`;

  // Read source CLAUDE.md to extract sections
  const sourceRead = await readTextFile(sourcePath);
  if (!sourceRead.ok) return sourceRead;

  const sourceSections = extractSections(sourceRead.value);
  if (sourceSections.size === 0) {
    return fail("read-failed", "No RLM sections found in source CLAUDE.md");
  }

  let targetContent = "";
  if (await fileExists(targetPath)) {
    const targetRead = await readTextFile(targetPath);
    if (!targetRead.ok) return targetRead;
    targetContent = targetRead.value;
  }

  // Replace existing sections or append new ones
  let updatedContent = targetContent;

  for (const [tag, section] of sourceSections) {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    const start = updatedContent.indexOf(openTag);
    const end = updatedContent.indexOf(closeTag);

    if (start !== -1 && end !== -1) {
      // Replace existing section
      updatedContent =
        updatedContent.slice(0, start) +
        section +
        updatedContent.slice(end + closeTag.length);
    } else {
      // Append new section
      const separator = updatedContent.length > 0 && !updatedContent.endsWith("\n\n")
        ? updatedContent.endsWith("\n") ? "\n" : "\n\n"
        : "";
      updatedContent += separator + section + "\n";
    }
  }

  if (dryRun) {
    console.log(`  Would write: ${targetPath}`);
    console.log(
      `  Sections: ${[...sourceSections.keys()].join(", ")}`,
    );
    return Result.ok(undefined);
  }

  return writeTextFile(targetPath, updatedContent);
};

const uninstallClaudeMd = async (
  target: string,
  dryRun: boolean,
): Promise<Result<void, InstallError>> => {
  const targetPath = `${target}/CLAUDE.md`;

  if (!(await fileExists(targetPath))) {
    return Result.ok(undefined);
  }

  const readResult = await readTextFile(targetPath);
  if (!readResult.ok) return readResult;

  let content = readResult.value;
  let modified = false;

  for (const tag of CLAUDE_MD_SECTION_TAGS) {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    const start = content.indexOf(openTag);
    const end = content.indexOf(closeTag);

    if (start !== -1 && end !== -1) {
      // Remove section and any trailing newlines (up to 2)
      let removeEnd = end + closeTag.length;
      const trailing = content.slice(removeEnd, removeEnd + 2);
      if (trailing === "\n\n") removeEnd += 2;
      else if (trailing.startsWith("\n")) removeEnd += 1;

      content = content.slice(0, start) + content.slice(removeEnd);
      modified = true;
    }
  }

  if (!modified) return Result.ok(undefined);

  const trimmed = content.trim();

  if (dryRun) {
    if (trimmed.length === 0) {
      console.log(`  Would remove: ${targetPath} (empty after cleanup)`);
    } else {
      console.log(`  Would update: ${targetPath} (remove RLM sections)`);
    }
    return Result.ok(undefined);
  }

  if (trimmed.length === 0) {
    try {
      await Deno.remove(targetPath);
    } catch (e) {
      return fail(
        "write-failed",
        `Failed to remove ${targetPath}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return Result.ok(undefined);
  }

  return writeTextFile(targetPath, trimmed + "\n");
};

// ---------------------------------------------------------------------------
// Phase 4: Merge deno.json Tasks
// ---------------------------------------------------------------------------

const mergeDenoJson = async (
  target: string,
  dryRun: boolean,
): Promise<Result<void, InstallError>> => {
  const denoJsonPath = `${target}/deno.json`;
  const denoJsoncPath = `${target}/deno.jsonc`;

  // Warn about deno.jsonc
  if (await fileExists(denoJsoncPath)) {
    console.log(
      "  Warning: found deno.jsonc - creating separate deno.json. Consider merging manually.",
    );
  }

  let denoConfig: Record<string, unknown> = {};

  if (await fileExists(denoJsonPath)) {
    const readResult = await readTextFile(denoJsonPath);
    if (!readResult.ok) return readResult;

    const parseResult = parseJson(readResult.value, denoJsonPath);
    if (!parseResult.ok) return parseResult;

    denoConfig = parseResult.value;
  }

  const tasks = (denoConfig.tasks ?? {}) as Record<string, string>;

  for (const key of RLM_TASK_KEYS) {
    tasks[key] = RLM_TASKS[key];
  }

  denoConfig.tasks = tasks;

  if (dryRun) {
    console.log(`  Would write: ${denoJsonPath}`);
    console.log(`  Tasks: ${RLM_TASK_KEYS.join(", ")}`);
    return Result.ok(undefined);
  }

  return writeTextFile(
    denoJsonPath,
    JSON.stringify(denoConfig, null, 2) + "\n",
  );
};

const uninstallDenoJson = async (
  target: string,
  dryRun: boolean,
): Promise<Result<void, InstallError>> => {
  const denoJsonPath = `${target}/deno.json`;

  if (!(await fileExists(denoJsonPath))) {
    return Result.ok(undefined);
  }

  const readResult = await readTextFile(denoJsonPath);
  if (!readResult.ok) return readResult;

  const parseResult = parseJson(readResult.value, denoJsonPath);
  if (!parseResult.ok) return parseResult;

  const denoConfig = parseResult.value;
  const tasks = (denoConfig.tasks ?? {}) as Record<string, string>;

  let modified = false;
  for (const key of RLM_TASK_KEYS) {
    if (key in tasks) {
      delete tasks[key];
      modified = true;
    }
  }

  if (!modified) return Result.ok(undefined);

  denoConfig.tasks = tasks;

  if (dryRun) {
    console.log(`  Would update: ${denoJsonPath} (remove RLM tasks)`);
    return Result.ok(undefined);
  }

  return writeTextFile(
    denoJsonPath,
    JSON.stringify(denoConfig, null, 2) + "\n",
  );
};

// ---------------------------------------------------------------------------
// Phase 5: Build Trailer Index
// ---------------------------------------------------------------------------

const buildTrailerIndex = async (
  target: string,
  dryRun: boolean,
): Promise<void> => {
  if (dryRun) {
    console.log("  Would run: deno task index:build");
    return;
  }

  try {
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-run",
        "--allow-read",
        "--allow-write",
        "scripts/build-trailer-index.ts",
      ],
      cwd: target,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      console.log(
        "  Note: trailer index build returned non-zero (expected for repos without structured commits)",
      );
    }
  } catch {
    console.log(
      "  Note: could not run trailer index build (non-fatal)",
    );
  }
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export const install = async (
  args: readonly string[],
): Promise<Result<void, InstallError>> => {
  const flagsResult = parseFlags(args);
  if (!flagsResult.ok) return flagsResult;

  const { target, dryRun, uninstall, skipHooks } = flagsResult.value;
  const sourceDir = resolveSourceDir();

  if (dryRun) {
    console.log(
      `Dry run: ${uninstall ? "uninstalling" : "installing"} RLM in ${target}`,
    );
  }

  // Phase 0: Prerequisites
  const prereqResult = await validatePrerequisites(target);
  if (!prereqResult.ok) return prereqResult;

  if (uninstall) {
    // --- Uninstall flow ---

    console.log(`Uninstalling RLM from ${target}\n`);

    // Phase 1: Remove scripts
    console.log("Phase 1: Scripts");
    const removeResult = await uninstallScripts(target, dryRun);
    if (!removeResult.ok) return removeResult;
    console.log(
      `  ${dryRun ? "Would remove" : "Removed"} ${removeResult.value} files`,
    );

    // Phase 2: Remove hooks
    if (!skipHooks) {
      console.log("Phase 2: Hooks");
      const hookResult = await uninstallHooks(target, dryRun);
      if (!hookResult.ok) return hookResult;
    } else {
      console.log("Phase 2: Hooks (skipped)");
    }

    // Phase 3: Remove CLAUDE.md sections
    console.log("Phase 3: CLAUDE.md");
    const claudeResult = await uninstallClaudeMd(target, dryRun);
    if (!claudeResult.ok) return claudeResult;

    // Phase 4: Remove deno.json tasks
    console.log("Phase 4: deno.json");
    const denoResult = await uninstallDenoJson(target, dryRun);
    if (!denoResult.ok) return denoResult;

    console.log("\nRLM uninstalled successfully.");
    return Result.ok(undefined);
  }

  // --- Install flow ---

  console.log(`Installing RLM into ${target}\n`);

  // Phase 1: Copy scripts
  console.log("Phase 1: Scripts");
  const copyResult = await copyScripts(sourceDir, target, dryRun);
  if (!copyResult.ok) return copyResult;
  console.log(
    `  ${dryRun ? "Would copy" : "Copied"} ${copyResult.value} files`,
  );

  // Phase 2: Merge hooks
  if (!skipHooks) {
    console.log("Phase 2: Hooks");
    const hookResult = await mergeHooks(target, dryRun);
    if (!hookResult.ok) return hookResult;
  } else {
    console.log("Phase 2: Hooks (skipped)");
  }

  // Phase 3: Update CLAUDE.md
  console.log("Phase 3: CLAUDE.md");
  const claudeResult = await updateClaudeMd(sourceDir, target, dryRun);
  if (!claudeResult.ok) return claudeResult;

  // Phase 4: Merge deno.json tasks
  console.log("Phase 4: deno.json");
  const denoResult = await mergeDenoJson(target, dryRun);
  if (!denoResult.ok) return denoResult;

  // Phase 5: Build trailer index
  console.log("Phase 5: Trailer index");
  await buildTrailerIndex(target, dryRun);

  // Phase 6: Summary
  console.log(`
RLM installed successfully in ${target}

  Scripts:      ${target}/scripts/ (${SCRIPT_MANIFEST.length} files)
  Hooks:        .claude/settings.json (${Object.keys(RLM_HOOKS).length} hook events)${skipHooks ? " (skipped)" : ""}
  Instructions: CLAUDE.md (${CLAUDE_MD_SECTION_TAGS.length} sections)
  Tasks:        deno.json (${RLM_TASK_KEYS.length} tasks)

Next steps:
  1. Start a Claude Code session in the target project
  2. The hooks will inject context automatically
  3. Optional: deno task rlm:configure -- --enable --check`);

  return Result.ok(undefined);
};

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export {
  type Flags,
  type InstallError,
  type InstallErrorTag,
  SCRIPT_MANIFEST,
  RLM_HOOKS,
  RLM_HOOK_MARKERS,
  CLAUDE_MD_SECTION_TAGS,
  RLM_TASK_KEYS,
  RLM_TASKS,
  parseFlags,
  validatePrerequisites,
  copyScripts,
  uninstallScripts,
  mergeHooks,
  uninstallHooks,
  updateClaudeMd,
  uninstallClaudeMd,
  mergeDenoJson,
  uninstallDenoJson,
  extractSections,
  isRlmHook,
  fileExists,
  resolveSourceDir,
};

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const result = await install(Deno.args);
  if (!result.ok) {
    console.error(`Error [${result.error.tag}]: ${result.error.message}`);
    Deno.exit(1);
  }
}
