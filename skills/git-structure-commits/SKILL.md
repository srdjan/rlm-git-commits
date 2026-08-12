---
name: git-structure-commits
description: >
  Generate semantically structured git commit messages using Conventional Commits
  with typed trailers. Commits serve dual purpose: human-readable change log and
  machine-parseable agent memory. Use whenever committing code changes, whether
  in agentic coding sessions or human-driven development. Produces commits that
  agents can query via `git log` to reconstruct intent, decisions, and scope
  without external memory infrastructure.
---

# Structured Git Commits

## Purpose

Git commits are the only artifact that is always present, always versioned, and
always co-located with the code. This skill turns them into a lightweight agent
memory layer by enforcing structured trailers with a controlled vocabulary,
making every commit both human-scannable and machine-queryable.

## When to Use

- Every `git commit` during agentic coding sessions
- When committing on behalf of a user in Claude Code or similar tools
- When generating commit messages from diffs or change descriptions
- When reconstructing session context from commit history

## Commit Format

Read the full specification: `references/commit-format.md`

### Quick Reference

```
<type>(<scope>): <Subject>          ← 50 target, 72 max, capitalized

<body>                               ← What and why, hard-wrapped at 72

Intent: <intent-type>                ← REQUIRED — from controlled vocabulary
Scope: <domain/module>[, ...]        ← REQUIRED — affected areas
Decided-Against: <alternative>       ← Optional — rejected approaches
Session: <session-id>                ← Optional — groups related commits
Refs: <commit|issue|doc>[, ...]      ← Optional — related artifacts
Context: <compact-json>             ← Optional — rich structured metadata
```

Blank lines around the body are mandatory. Trailers are exempt from the
72-column wrap; body text is not.

### Intent Taxonomy (Controlled Vocabulary)

These are the ONLY valid values for the `Intent:` trailer. Read the full
definitions and usage guidance: `references/intent-taxonomy.md`

| Intent | When to use |
|--------|-------------|
| `enable-capability` | Adding new user-facing or system capability |
| `fix-defect` | Correcting incorrect behavior |
| `improve-quality` | Non-functional improvement (perf, readability, resilience) |
| `restructure` | Architectural change, module extraction, code movement |
| `configure-infra` | Tooling, CI/CD, dependencies, build system |
| `document` | Documentation, ADRs, comments, API docs |
| `explore` | Spike, prototype, hypothesis validation |
| `resolve-blocker` | Unblocking a dependent task or workflow |

### Trailer Rules

1. **Intent** — REQUIRED. Exactly one value from the taxonomy.
2. **Scope** — REQUIRED. Comma-separated `domain/module` paths. Use the same
   vocabulary as your project's directory structure or domain model. The Scope
   trailer provides richer domain-level filtering than the header's parenthetical
   scope, which is optimized for log readability.
3. **Decided-Against** — Include whenever a non-trivial alternative was
   considered and rejected. This is the highest-value trailer for agent memory.
   Format: `<approach> (<reason>)` or multiple on separate trailers.
4. **Session** — ISO date + slug: `2025-02-08/passkey-lib`. Groups commits
   from the same logical working session.
5. **Refs** — Commit SHAs (short), issue numbers, doc paths. Comma-separated.
6. **Context** — Compact single-line JSON for structured metadata that doesn't
   fit in other trailers. Use sparingly. Example:
   `Context: {"migration":"v2-to-v3","tables":["users","sessions"],"rollback":true}`

## Generating Commit Messages

### From a Diff

When given a diff (or after making changes), follow this process:

1. **Classify the change type** — Map to Conventional Commits type:
   `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore`
2. **Identify the narrowest scope** — What module or domain boundary does this
   touch? Use the parenthetical scope in the subject line.
3. **Write the subject in imperative mood** — "Add", "Fix", "Extract", not
   "Added", "Fixes", "Extracted". It must complete the sentence "If applied,
   this commit will ___". Capitalize the first word after the colon; leave the
   type and scope lowercase. No trailing period. Aim for 50 characters
   including `type(scope): `, and never exceed 72. A subject that will not fit
   is usually a commit that should be split.
4. **Write the body** — Explain *what* changed and *why*. Not *how* — the diff
   shows how. Hard-wrap every line at 72 characters, and leave one blank line
   between the subject and the body.
5. **Select the Intent** — From the controlled vocabulary. If uncertain between
   two, choose the one that describes the *motivation*, not the *mechanism*.
6. **List the Scope** — Domain paths affected. Be specific enough for filtering
   but not so granular that every file is listed.
7. **Record decisions** — If you considered alternatives, add `Decided-Against`
   trailers. This is the most valuable information for future agents. If you
   evaluated alternatives during implementation, record them immediately in a
   scratch note. Do not rely on memory at commit time. Format each entry as
   `<approach> (<reason>)` - the approach as a noun phrase, the reason as a
   concise clause in parentheses.

### From a Description

When the user describes what they want committed (e.g., "commit this with a
message about adding the auth flow"):

1. Review the staged changes (`git diff --cached`) to ground the message in
   actual code changes, not just the user's description.
2. Follow the same process as above.
3. Present the commit message for user review before committing.

### Multi-file Changes

If a commit touches multiple domains, consider whether it should be split. A
good heuristic: if the `Scope` trailer would have more than 3 entries, the
commit likely conflates multiple logical changes.

## Querying Commit History (Agent Memory Reconstruction)

### For Agents Loading Context

Agents reconstructing session context should query in this order:

```bash
# 1. Recent session commits (most common)
git log --format='%H %s' --grep='Session: 2025-02-08' -- .

# 2. Intent-filtered history
git log --format='%H %s' --grep='Intent: enable-capability' --since='1 week ago'

# 3. Decision archaeology (highest value for avoiding repeated work)
git log --format='%B' --grep='Decided-Against' -- path/to/module

# 4. Full structured parse of recent commits
git log -20 --format='---commit---%nHash: %H%nDate: %aI%nSubject: %s%n%b'
```

### Parsing Trailers Programmatically

```bash
# Extract all trailers from a specific commit
git log -1 --format='%(trailers)' <commit-hash>

# Extract a specific trailer value
git log -1 --format='%(trailers:key=Intent)' <commit-hash>

# All intents in the last 50 commits
git log -50 --format='%(trailers:key=Intent,valueonly)' | sort | uniq -c | sort -rn
```

A Deno parsing utility is available at `scripts/parse-commits.ts` for
richer queries and structured output:

```bash
# What was last done in module X?
deno task parse --scope=auth --limit=1

# Did anyone try approach Y before?
deno task parse --decided-against=redis

# What blockers have we hit?
deno task parse --intent=resolve-blocker

# What's being explored? (with full body for findings)
deno task parse --intent=explore --with-body

# All decisions in a specific session
deno task parse --session=2025-02-08/passkey-lib --decisions-only
```

## Examples

### Simple Feature

```
feat(auth): Add passkey registration for agents

Implement WebAuthn registration for non-human identity types. Agent
identities derive keys deterministically instead of prompting for a
user gesture, so credentials can be provisioned during onboarding.

Intent: enable-capability
Scope: auth/registration, identity/agent
Decided-Against: OAuth2 client credentials (no hardware binding guarantee)
Session: 2025-02-08/passkey-lib
```

### Bug Fix with Decision Context

```
fix(api): Prevent duplicate webhook delivery

Race between the retry scheduler and delivery confirmation sent a
second POST when upstream answered between 28 and 30 seconds - inside
the timeout window but after the retry was already queued.

Intent: fix-defect
Scope: api/webhooks, infra/scheduler
Decided-Against: idempotency key at receiver (shifts burden to consumers)
Decided-Against: longer timeout window (masks upstream latency issues)
Refs: #1847, abc123f
```

### Architectural Refactor

```
refactor(orders): Extract pricing engine

Pricing logic lived inside the Order aggregate root, so pricing rules
could not be tested on their own or reused by the quote flow. Extract
them into a standalone PricingEngine with a pure function interface.

Intent: restructure
Scope: orders/pricing, orders/aggregate, quotes/pricing
Decided-Against: shared library approach (coupling between bounded contexts)
Context: {"pattern":"extract-module","loc_moved":340,"tests_added":12}
Session: 2025-02-08/order-decomposition
```

### Exploratory Spike

```
feat(search): Prototype pgvector similarity search

Validate whether pgvector handles our 1536-dimension embeddings at
current scale (~2M rows) with acceptable p99 latency. Result: p99 is
45ms with an HNSW index - fast enough for async enrichment, too slow
for the synchronous search path.

Intent: explore
Scope: search/vector, infra/postgres
Decided-Against: Pinecone (operational complexity, vendor lock-in)
Decided-Against: in-memory FAISS (no persistence, scaling concerns)
Context: {"benchmark":{"p50_ms":12,"p99_ms":45,"rows":"2M","index":"hnsw"}}
Session: 2025-02-07/vector-search-spike
```

### Infrastructure Configuration

```
build(ci): Run workspace tests in parallel

Deno workspaces can run independent workspace tests concurrently, so
configure the CI pipeline to use that instead of a serial run. Wall
time drops from about 8 minutes to about 3.

Intent: configure-infra
Scope: ci/pipeline, build/workspaces
Decided-Against: custom test orchestrator script (unnecessary given native support)
```

## Anti-Patterns

- **Scope as file paths** — Use domain concepts (`auth/registration`), not
  file paths (`src/modules/auth/handlers/register.ts`).
- **Multiple intents per commit** — If you need two intents, split the commit.
- **Empty body** — The subject line is not enough. Agents need the *why*.
- **Subject that lists** — "Add X and fix Y" is two commits wearing one hat.
  A comma or an "and" in the subject is a split signal.
- **Unwrapped body** — Your editor soft-wraps; git does not. Hard-wrap at 72
  or the message becomes one long line in every terminal that reads it.
- **Body that narrates the diff** — "Changed line 42 to use map()" is *how*.
  The diff already says that. Write the reason the change exists.
- **`Context` as a dumping ground** — Only use for genuinely structured data
  that other trailers can't express. If you're putting prose in `Context`,
  it belongs in the body.
- **Generic scopes** — `Scope: backend` tells agents nothing useful.
  `Scope: auth/session, api/middleware` enables filtering.
- **Omitting `Decided-Against`** — When you consider alternatives and don't
  record them, the next agent will waste time re-evaluating the same options.
