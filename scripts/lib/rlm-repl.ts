/**
 * REPL loop: the core of the true RLM implementation.
 *
 * The local LLM writes JavaScript code that executes in a sandboxed
 * Worker against the pre-loaded git history index. The LLM decides
 * what to inspect, when to recurse (via callLlm), and when to stop
 * (via done()). Three-layer safety: per-LLM-call timeout, per-execution
 * timeout, and total wall-clock budget.
 *
 * Interfaces define effects/capabilities; types define data shapes.
 */

import { Result } from "../types.ts";
import type { TrailerIndex } from "../types.ts";
import { INTENT_TYPES } from "../types.ts";
import type { RlmConfig } from "./rlm-config.ts";
import type { WorkingMemory } from "./working-memory.ts";
import type { ChatMessage } from "./local-llm.ts";
import { extractCodeBlock } from "./rlm-code-extractor.ts";
import { buildReplSystemPrompt } from "./rlm-system-prompt.ts";
import { createSandbox, type SandboxEnv } from "./rlm-sandbox.ts";

// ---------------------------------------------------------------------------
// Capability interfaces (effects)
// ---------------------------------------------------------------------------

/**
 * Call the local LLM. Injected to allow testing without HTTP.
 */
export interface CallLlm {
  (messages: readonly ChatMessage[], maxTokens: number): Promise<Result<string>>;
}

/**
 * Execute a git log command. Injected to allow testing without git.
 */
export interface ExecGitLog {
  (args: readonly string[]): Promise<Result<string>>;
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export type ReplConfig = {
  readonly maxIterations: number;
  readonly maxLlmCalls: number;
  readonly timeoutBudgetMs: number;
  readonly maxOutputTokens: number;
};

export type ReplTraceEntry = {
  readonly iteration: number;
  readonly codeGenerated: string;
  readonly executionResult: string;
  readonly subCallCount: number;
};

export type ReplResult = {
  readonly answer: string;
  readonly iterations: number;
  readonly llmCalls: number;
  readonly elapsedMs: number;
  readonly trace: readonly ReplTraceEntry[];
};

export type ReplEnv = {
  readonly index: TrailerIndex;
  readonly workingMemory: WorkingMemory | null;
  readonly scopeKeys: readonly string[];
};

// ---------------------------------------------------------------------------
// Extract ReplConfig from RlmConfig
// ---------------------------------------------------------------------------

export const replConfigFromRlm = (config: RlmConfig): ReplConfig => ({
  maxIterations: config.replMaxIterations,
  maxLlmCalls: config.replMaxLlmCalls,
  timeoutBudgetMs: config.replTimeoutBudgetMs,
  maxOutputTokens: config.replMaxOutputTokens,
});

// ---------------------------------------------------------------------------
// REPL Loop
// ---------------------------------------------------------------------------

export const runRepl = async (
  rlmConfig: RlmConfig,
  replConfig: ReplConfig,
  prompt: string,
  env: ReplEnv,
  callLlm: CallLlm,
  execGitLog: ExecGitLog,
): Promise<Result<ReplResult>> => {
  const startTime = performance.now();
  let llmCallCount = 0;
  const trace: ReplTraceEntry[] = [];

  const budgetExhausted = (): boolean =>
    performance.now() - startTime > replConfig.timeoutBudgetMs;

  const llmBudgetLeft = (): boolean =>
    llmCallCount < replConfig.maxLlmCalls;

  // Wrapper that tracks LLM call count for sub-calls from inside the sandbox
  const trackedLlmCall = async (
    messages: readonly ChatMessage[],
  ): Promise<Result<string>> => {
    if (!llmBudgetLeft()) {
      return Result.fail(new Error("LLM call budget exhausted"));
    }
    llmCallCount++;
    return callLlm(messages, rlmConfig.maxTokens);
  };

  // Build the system prompt
  const systemPrompt = buildReplSystemPrompt({
    scopeKeySample: env.scopeKeys,
    intentTypes: [...INTENT_TYPES],
    commitCount: env.index.commitCount,
    hasWorkingMemory: env.workingMemory !== null,
    budget: {
      maxIterations: replConfig.maxIterations,
      maxLlmCalls: replConfig.maxLlmCalls,
    },
  });

  const conversation: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Task: ${prompt}\n\nWrite JavaScript code to find relevant context from the git history index.`,
    },
  ];

  // Create sandbox
  const sandboxEnv: SandboxEnv = {
    index: env.index,
    workingMemory: env.workingMemory,
    scopeKeys: env.scopeKeys,
  };

  const sandbox = createSandbox(sandboxEnv, trackedLlmCall, execGitLog);

  try {
    for (let i = 0; i < replConfig.maxIterations; i++) {
      if (budgetExhausted() || !llmBudgetLeft()) break;

      // Root LLM call
      llmCallCount++;
      const llmResult = await callLlm(conversation, replConfig.maxOutputTokens);

      if (!llmResult.ok) {
        return Result.fail(llmResult.error);
      }

      const llmResponse = llmResult.value;
      const code = extractCodeBlock(llmResponse);

      // No code block — treat as final text answer
      if (code === null) {
        return Result.ok({
          answer: llmResponse,
          iterations: i + 1,
          llmCalls: llmCallCount,
          elapsedMs: performance.now() - startTime,
          trace,
        });
      }

      conversation.push({ role: "assistant", content: llmResponse });

      // Execute the code in the sandbox
      const subCallsBefore = llmCallCount;
      const execResult = await sandbox.execute(code);

      if (!execResult.ok) {
        // Sandbox timeout or crash — tell the LLM
        conversation.push({
          role: "user",
          content: `Execution error: ${execResult.error.message}\nTry a simpler approach or call done() with your best answer.`,
        });
        trace.push({
          iteration: i,
          codeGenerated: code,
          executionResult: `ERROR: ${execResult.error.message}`,
          subCallCount: llmCallCount - subCallsBefore,
        });
        continue;
      }

      const output = execResult.value;

      trace.push({
        iteration: i,
        codeGenerated: code,
        executionResult: output.error
          ? `ERROR: ${output.error}\n${output.stdout}`
          : output.stdout,
        subCallCount: llmCallCount - subCallsBefore,
      });

      // done() was called — return the answer
      if (output.done && output.doneAnswer) {
        return Result.ok({
          answer: output.doneAnswer,
          iterations: i + 1,
          llmCalls: llmCallCount,
          elapsedMs: performance.now() - startTime,
          trace,
        });
      }

      // Execution error — feed it back so the LLM can correct
      if (output.error) {
        conversation.push({
          role: "user",
          content: `Execution error: ${output.error}\n${output.stdout ? "Partial output:\n" + output.stdout : ""}Fix the error or call done() with your best answer.`,
        });
        continue;
      }

      // Success — show output and ask for continuation
      conversation.push({
        role: "user",
        content: `Output:\n${output.stdout || "(no output)"}\n\nContinue analysis or call done(answer) with your summary.`,
      });
    }

    // Budget exhausted — force a final text answer
    if (llmBudgetLeft() && !budgetExhausted()) {
      conversation.push({
        role: "user",
        content: "Iteration budget exhausted. Provide your best answer as plain text (no code block).",
      });

      llmCallCount++;
      const finalResult = await callLlm(conversation, replConfig.maxOutputTokens);

      if (finalResult.ok) {
        return Result.ok({
          answer: finalResult.value,
          iterations: replConfig.maxIterations + 1,
          llmCalls: llmCallCount,
          elapsedMs: performance.now() - startTime,
          trace,
        });
      }
    }

    // Complete failure — return what we have
    const lastOutput = trace.length > 0
      ? trace[trace.length - 1].executionResult
      : "No output produced";
    return Result.ok({
      answer: lastOutput,
      iterations: trace.length,
      llmCalls: llmCallCount,
      elapsedMs: performance.now() - startTime,
      trace,
    });
  } finally {
    sandbox.terminate();
  }
};
