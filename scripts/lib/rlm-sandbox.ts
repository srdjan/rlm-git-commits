/**
 * Sandboxed JavaScript execution environment for the REPL loop.
 *
 * Uses a Deno Worker with zero OS permissions. All I/O (LLM calls,
 * git log) goes through message-passing to the host. The Worker
 * receives the trailer index and working memory as data on init,
 * then executes LLM-generated code strings against that data.
 *
 * Interfaces define effects/capabilities; types define data shapes.
 */

import type { IndexedCommit, IntentType, TrailerIndex } from "../types.ts";
import { Result } from "../types.ts";
import type { WorkingMemory } from "./working-memory.ts";
import type { ChatMessage } from "./local-llm.ts";

// ---------------------------------------------------------------------------
// Capability interfaces (effects)
// ---------------------------------------------------------------------------

/**
 * Execute code strings in a sandboxed environment.
 * The sandbox maintains state across executions within a session.
 */
export interface Sandbox {
  execute(code: string): Promise<Result<SandboxOutput>>;
  terminate(): void;
}

/**
 * Host-side handler for LLM sub-calls from within the sandbox.
 */
export interface LlmCallHandler {
  (messages: readonly ChatMessage[]): Promise<Result<string>>;
}

/**
 * Host-side handler for git log calls from within the sandbox.
 */
export interface GitLogHandler {
  (args: readonly string[]): Promise<Result<string>>;
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export type SandboxOutput = {
  readonly stdout: string;
  readonly returnValue: unknown;
  readonly error: string | null;
  readonly done: boolean;
  readonly doneAnswer: string | null;
};

export type SandboxEnv = {
  readonly index: TrailerIndex;
  readonly workingMemory: WorkingMemory | null;
  readonly scopeKeys: readonly string[];
};

// Worker ↔ Host message protocol
type HostToWorker =
  | { readonly kind: "init"; readonly env: SandboxEnv }
  | { readonly kind: "execute"; readonly code: string }
  | { readonly kind: "llm-response"; readonly id: number; readonly result: { readonly ok: boolean; readonly value?: string; readonly error?: string } }
  | { readonly kind: "gitlog-response"; readonly id: number; readonly result: { readonly ok: boolean; readonly value?: string; readonly error?: string } };

type WorkerToHost =
  | { readonly kind: "result"; readonly output: SandboxOutput }
  | { readonly kind: "llm-request"; readonly id: number; readonly messages: readonly ChatMessage[] }
  | { readonly kind: "gitlog-request"; readonly id: number; readonly args: readonly string[] }
  | { readonly kind: "ready" };

// ---------------------------------------------------------------------------
// Git log argument sanitization
// ---------------------------------------------------------------------------

const ALLOWED_GIT_LOG_FLAGS = new Set([
  "--format",
  "--author",
  "--since",
  "--until",
  "--grep",
  "--no-merges",
  "-n",
]);

const DANGEROUS_CHARS = /[|;&$`\\]/;

export const sanitizeGitLogArgs = (
  args: readonly string[],
): Result<readonly string[]> => {
  const sanitized: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (DANGEROUS_CHARS.test(arg)) {
      return Result.fail(new Error(`Dangerous character in git log arg: ${arg}`));
    }

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      const flag = eqIdx >= 0 ? arg.slice(0, eqIdx) : arg;
      if (!ALLOWED_GIT_LOG_FLAGS.has(flag)) {
        return Result.fail(new Error(`Disallowed git log flag: ${flag}`));
      }
      sanitized.push(arg);
    } else if (arg === "-n") {
      sanitized.push(arg);
      // Next arg should be a number, cap at 50
      const next = args[i + 1];
      if (next !== undefined) {
        const n = parseInt(next, 10);
        if (isNaN(n) || n < 1) {
          return Result.fail(new Error(`Invalid -n value: ${next}`));
        }
        sanitized.push(String(Math.min(n, 50)));
        i++;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      // Single-char flags not in allowed set
      return Result.fail(new Error(`Disallowed git log flag: ${arg}`));
    } else {
      // Positional arg (path spec, etc.) — allow but sanitize
      sanitized.push(arg);
    }
  }

  return Result.ok(sanitized);
};

// ---------------------------------------------------------------------------
// Worker source builder
// ---------------------------------------------------------------------------

/**
 * Build the JavaScript source that runs inside the Worker.
 *
 * The Worker has zero Deno permissions — all I/O goes through
 * postMessage. Query logic from query.ts and matching.ts is
 * duplicated here as pure functions.
 *
 * Uses string concatenation (not template literals) to avoid
 * escaping conflicts with regex and replacement patterns.
 */
// deno-lint-ignore no-unused-vars
const buildWorkerSource = (): string => [
  "// State",
  "let index = null;",
  "let workingMemory = null;",
  "let scopeKeys = [];",
  "let nextRequestId = 1;",
  "const pendingRequests = new Map();",
  "let stdoutBuffer = '';",
  "let doneSignal = null;",
  "",
  "// Matching (duplicated from matching.ts)",
  "const scopeMatches = (sv, pat) => {",
  "  const s = sv.toLowerCase(), p = pat.toLowerCase();",
  "  return s === p || (s.startsWith(p) && s[p.length] === '/');",
  "};",
  "const wordBoundaryMatch = (text, kw) => {",
  "  const esc = kw.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');",
  "  return new RegExp('\\\\b' + esc + '\\\\b', 'i').test(text);",
  "};",
  "",
  "// Query (duplicated from query.ts)",
  "const queryIndexForHashes = (idx, p) => {",
  "  let cands = null;",
  "  const intersect = (hs) => {",
  "    const s = new Set(hs);",
  "    if (cands === null) { cands = s; }",
  "    else { for (const h of cands) { if (!s.has(h)) cands.delete(h); } }",
  "  };",
  "  if (p.intents && p.intents.length > 0) {",
  "    const ih = new Set();",
  "    for (const i of p.intents) { for (const h of (idx.byIntent[i]||[])) ih.add(h); }",
  "    intersect([...ih]);",
  "  }",
  "  if (p.session) intersect(idx.bySession[p.session] || []);",
  "  if (p.decidedAgainst) {",
  "    const kw = p.decidedAgainst, m = [];",
  "    for (const h of idx.withDecidedAgainst) {",
  "      const c = idx.commits[h];",
  "      if (c && c.decidedAgainst.some(d => wordBoundaryMatch(d, kw))) m.push(h);",
  "    }",
  "    intersect(m);",
  "  }",
  "  if (p.scope) {",
  "    const mh = [];",
  "    for (const [sk, hs] of Object.entries(idx.byScope)) {",
  "      if (scopeMatches(sk, p.scope)) mh.push(...hs);",
  "    }",
  "    intersect(mh);",
  "  }",
  "  if (cands === null) return [];",
  "  return [...cands].slice(0, p.limit || 20);",
  "};",
  "",
  "// API",
  "const query = (params) => {",
  "  if (!index) return [];",
  "  const hs = queryIndexForHashes(index, params || {});",
  "  return hs.map(h => index.commits[h]).filter(Boolean);",
  "};",
  "const callLlm = (msgs) => {",
  "  const id = nextRequestId++;",
  "  self.postMessage({ kind: 'llm-request', id, messages: msgs });",
  "  return new Promise((res, rej) => { pendingRequests.set(id, { resolve: res, reject: rej }); });",
  "};",
  "const gitLog = (args) => {",
  "  const id = nextRequestId++;",
  "  self.postMessage({ kind: 'gitlog-request', id, args: args || [] });",
  "  return new Promise((res, rej) => { pendingRequests.set(id, { resolve: res, reject: rej }); });",
  "};",
  "const done = (answer) => {",
  "  doneSignal = typeof answer === 'string' ? answer : String(answer);",
  "};",
  "",
  "// Console capture",
  "console.log = (...args) => {",
  "  const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');",
  "  stdoutBuffer += line + '\\n';",
  "};",
  "",
  "// Message handler",
  "self.onmessage = async (e) => {",
  "  const msg = e.data;",
  "  if (msg.kind === 'init') {",
  "    index = msg.env.index;",
  "    workingMemory = msg.env.workingMemory;",
  "    scopeKeys = msg.env.scopeKeys;",
  "    self.postMessage({ kind: 'ready' });",
  "    return;",
  "  }",
  "  if (msg.kind === 'llm-response' || msg.kind === 'gitlog-response') {",
  "    const pend = pendingRequests.get(msg.id);",
  "    if (pend) {",
  "      pendingRequests.delete(msg.id);",
  "      if (msg.result.ok) pend.resolve(msg.result.value);",
  "      else pend.reject(new Error(msg.result.error || 'Request failed'));",
  "    }",
  "    return;",
  "  }",
  "  if (msg.kind === 'execute') {",
  "    stdoutBuffer = '';",
  "    doneSignal = null;",
  "    let rv = undefined, err = null;",
  "    try {",
  "      const fn = new Function('index','workingMemory','scopeKeys','query','callLlm','gitLog','done', msg.code);",
  "      rv = await fn(index, workingMemory, scopeKeys, query, callLlm, gitLog, done);",
  "    } catch (e) {",
  "      err = e instanceof Error ? e.message : String(e);",
  "    }",
  "    self.postMessage({",
  "      kind: 'result',",
  "      output: { stdout: stdoutBuffer, returnValue: rv === undefined ? null : rv, error: err, done: doneSignal !== null, doneAnswer: doneSignal }",
  "    });",
  "  }",
  "};",
].join("\n");

// ---------------------------------------------------------------------------
// Sandbox factory
// ---------------------------------------------------------------------------

const EXECUTE_TIMEOUT_MS = 2000;

export const createSandbox = (
  env: SandboxEnv,
  onLlmCall: LlmCallHandler,
  onGitLog: GitLogHandler,
): Sandbox => {
  const workerSource = buildWorkerSource();
  const blob = new Blob([workerSource], { type: "application/javascript" });
  const blobUrl = URL.createObjectURL(blob);

  const worker = new Worker(blobUrl, {
    type: "module",
    // @ts-ignore Deno Worker permissions API
    deno: {
      permissions: {
        read: false,
        write: false,
        net: false,
        run: false,
        env: false,
        ffi: false,
      },
    },
  });

  // Track initialization
  let initialized = false;
  const initPromise = new Promise<void>((resolve) => {
    const handler = (e: MessageEvent) => {
      if (e.data.kind === "ready") {
        initialized = true;
        worker.removeEventListener("message", handler);
        resolve();
      }
    };
    worker.addEventListener("message", handler);
  });

  // Send init data
  worker.postMessage({ kind: "init", env } satisfies HostToWorker);

  const execute = async (code: string): Promise<Result<SandboxOutput>> => {
    if (!initialized) await initPromise;

    return new Promise<Result<SandboxOutput>>((resolve) => {
      const timer = setTimeout(() => {
        resolve(Result.fail(new Error("Sandbox execution timed out")));
      }, EXECUTE_TIMEOUT_MS);

      const handler = async (e: MessageEvent) => {
        const msg = e.data as WorkerToHost;

        if (msg.kind === "llm-request") {
          const result = await onLlmCall(msg.messages);
          const response: HostToWorker = {
            kind: "llm-response",
            id: msg.id,
            result: result.ok
              ? { ok: true, value: result.value }
              : { ok: false, error: result.error.message },
          };
          worker.postMessage(response);
          return;
        }

        if (msg.kind === "gitlog-request") {
          const sanitized = sanitizeGitLogArgs(msg.args);
          if (!sanitized.ok) {
            worker.postMessage({
              kind: "gitlog-response",
              id: msg.id,
              result: { ok: false, error: sanitized.error.message },
            } satisfies HostToWorker);
            return;
          }
          const result = await onGitLog(sanitized.value);
          worker.postMessage({
            kind: "gitlog-response",
            id: msg.id,
            result: result.ok
              ? { ok: true, value: result.value }
              : { ok: false, error: result.error.message },
          } satisfies HostToWorker);
          return;
        }

        if (msg.kind === "result") {
          clearTimeout(timer);
          worker.removeEventListener("message", handler);
          resolve(Result.ok(msg.output));
        }
      };

      worker.addEventListener("message", handler);
      worker.postMessage({ kind: "execute", code } satisfies HostToWorker);
    });
  };

  const terminate = (): void => {
    worker.terminate();
    URL.revokeObjectURL(blobUrl);
  };

  return { execute, terminate };
};
