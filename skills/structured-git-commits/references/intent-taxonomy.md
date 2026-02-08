# Intent Taxonomy — Controlled Vocabulary

## Design Principles

The intent taxonomy captures WHY a change exists, not WHAT it is. The
Conventional Commits type already classifies the mechanism (`feat`, `fix`,
`refactor`). Intent classifies the strategic motivation.

Key design decisions:
- **8 intents** — small enough to memorize, large enough to be meaningful
- **Mutually exclusive** — every commit maps to exactly one intent
- **Agent-queryable** — each intent produces useful filtered views
- **Stable vocabulary** — resist adding new intents without strong justification

---

## The Taxonomy

### `enable-capability`

**Definition:** Adding a new capability that didn't exist before — something a
user, system, or agent can now do that it couldn't previously.

**Maps to types:** Usually `feat`, occasionally `build` or `ci`

**Decision test:** "After this commit, can someone do something they couldn't
before?" If yes → `enable-capability`.

**Examples:**
- Add passkey registration for agent identities
- Implement PDF export for reports
- Add webhook delivery for order events
- Enable parallel test execution in CI

**Not this when:** You're extending an existing capability (that's still
`enable-capability` if it's a distinct new affordance) or improving how an
existing capability works (that's `improve-quality`).

---

### `fix-defect`

**Definition:** Correcting behavior that doesn't match the intended
specification or expectation. Something was supposed to work one way and
doesn't.

**Maps to types:** Usually `fix`, occasionally `refactor` (for logic bugs
fixed during restructuring)

**Decision test:** "Was there a bug, regression, or incorrect behavior?" If
yes → `fix-defect`.

**Examples:**
- Fix race condition in webhook retry logic
- Correct timezone offset in schedule calculations
- Prevent null pointer when user has no default address
- Fix CSS layout overflow on mobile viewports

**Not this when:** You're improving error handling for edge cases that weren't
bugs (that's `improve-quality`) or working around an upstream limitation
(that's `resolve-blocker`).

---

### `improve-quality`

**Definition:** Making existing functionality better without adding new
capabilities or fixing bugs. Covers performance, readability, resilience,
test coverage, error handling improvements, and general code quality.

**Maps to types:** `refactor`, `perf`, `test`

**Decision test:** "Does this make existing code better without changing
what it does from the user's perspective?" If yes → `improve-quality`.

**Examples:**
- Optimize database query to reduce p99 latency
- Add error boundary around payment processing
- Refactor handler chain for readability
- Add integration tests for order lifecycle
- Improve logging granularity in auth flow

**Not this when:** You're moving code between modules (that's `restructure`)
or the improvement was required to unblock something (that's `resolve-blocker`).

---

### `restructure`

**Definition:** Changing the architectural organization of code — extracting
modules, moving code between bounded contexts, splitting aggregates,
changing dependency direction. The behavior is preserved but the structure
changes meaningfully.

**Maps to types:** `refactor`

**Decision test:** "Did the module boundaries, dependency graph, or
architectural structure change?" If yes → `restructure`.

**Examples:**
- Extract pricing engine from order aggregate
- Move shared validation into domain kernel
- Split monolith auth module into authn/authz boundaries
- Invert dependency: make core independent of infrastructure

**Not this when:** You're cleaning up code within the same module without
changing boundaries (that's `improve-quality`). The key distinction is whether
module-level structure changed, not just internal code organization.

---

### `configure-infra`

**Definition:** Changes to tooling, build systems, CI/CD pipelines,
dependency management, development environment, or operational infrastructure
that don't directly affect application behavior.

**Maps to types:** `build`, `ci`, `chore`

**Decision test:** "Does this change how the project is built, tested,
deployed, or developed — without changing application behavior?" If yes →
`configure-infra`.

**Examples:**
- Update Deno to 2.1, adjust deprecated API calls
- Add pre-commit hook for structured commit validation
- Configure GitHub Actions for parallel workspace tests
- Add pgvector extension to Docker Compose dev environment

**Not this when:** The infrastructure change enables a new capability (e.g.,
adding a new database type to support vector search is `enable-capability`
if it's user-facing, `configure-infra` if it's purely operational).

---

### `document`

**Definition:** Adding or updating documentation, comments, ADRs, API docs,
or other written artifacts that don't change code behavior.

**Maps to types:** `docs`

**Decision test:** "Is this purely documentation with no code behavior change?"
If yes → `document`.

**Examples:**
- Add ADR for pricing engine extraction
- Update API docs for new webhook endpoints
- Add inline documentation for complex algorithm
- Write onboarding guide for new team members

**Not this when:** You're adding JSDoc/TSDoc as part of a code change — in
that case, use the intent that matches the code change and mention the docs
in the body.

---

### `explore`

**Definition:** Investigative work — spikes, prototypes, proof-of-concepts,
benchmarks, hypothesis validation. The commit captures what was learned,
not just what was built.

**Maps to types:** `feat` (for working prototypes), `test` (for benchmarks),
`docs` (for findings)

**Decision test:** "Is the primary goal learning or validation rather than
shipping?" If yes → `explore`.

**Commit body requirements for explore commits:**
- State the hypothesis or question being investigated
- Report results and conclusions
- Include quantitative data where applicable (put in `Context` trailer)

**Examples:**
- Prototype vector similarity search with pgvector
- Benchmark connection pooling strategies under load
- Spike: evaluate Zig for critical path performance
- Test hypothesis: can we derive agent keys deterministically?

**Not this when:** You've moved past exploration and are now implementing
the chosen approach (that's `enable-capability`).

---

### `resolve-blocker`

**Definition:** Changes made specifically to unblock another task, workflow,
or team. The change has value only in the context of enabling something else
to proceed.

**Maps to types:** Any — the type depends on what form the unblocking takes

**Decision test:** "Would I be making this change right now if it weren't
blocking something else?" If no → `resolve-blocker`.

**Examples:**
- Upgrade auth library to fix compatibility with new SDK
- Add temporary adapter for legacy API during migration
- Fix flaky test that blocks CI for unrelated PRs
- Expose internal method needed by downstream consumer

**Include in the body:** What was blocked and why this change unblocks it.

**Not this when:** The change has standalone value beyond unblocking (use the
intent that matches its standalone value).

---

## Disambiguation Guide

When two intents seem to fit, use these tiebreakers:

| If torn between... | Choose | When... |
|---|---|---|
| `enable-capability` vs `improve-quality` | `enable-capability` | Users can do something new |
| `improve-quality` vs `restructure` | `restructure` | Module boundaries changed |
| `restructure` vs `resolve-blocker` | `resolve-blocker` | You wouldn't restructure otherwise |
| `fix-defect` vs `improve-quality` | `fix-defect` | There's a specific bug report or incorrect behavior |
| `explore` vs `enable-capability` | `explore` | The code might be thrown away |
| `configure-infra` vs `enable-capability` | `enable-capability` | End users are affected |

## Common Edge Cases

These six scenarios cause the most hesitation. The existing taxonomy
handles all of them; the guidance below clarifies which intent to use.

### Reverts

Choose intent based on *why* you are reverting, not the fact that it is
a revert. Reverting a buggy feature = `fix-defect`. Reverting to unblock
a deploy = `resolve-blocker`. Reverting a failed experiment =
`explore`. Use the `revert` type but let the intent reflect motivation.

### Feature Removal / Deprecation

Use `improve-quality`. Removing dead code or deprecated features reduces
maintenance burden and attack surface. If the removal affects downstream
consumers, add the `Breaking:` trailer.

### Security Patches

Use `fix-defect`. Vulnerabilities are defects against security
requirements, even when the code "works as written." The bug is that a
security invariant is violated.

### Data Migrations

Intent matches the migration's purpose: enabling a new feature =
`enable-capability`, changing data architecture = `restructure`, fixing
data inconsistency = `fix-defect`. The migration mechanism does not
determine the intent; the business reason does.

### Test-Only Commits

Tests shipped with the feature use the feature's intent. Tests
backfilled later (coverage gaps, regression tests for old bugs) use
`improve-quality`.

### Dependency Updates

Routine version bumps = `configure-infra`. Security patches in
dependencies = `fix-defect`. Upgrades that enable new API usage = use
the intent of the feature consuming the new API (usually
`enable-capability` or `resolve-blocker`).

---

## Extending the Taxonomy

Resist the urge to add new intents. The value of a controlled vocabulary
comes from its stability and memorability. Before proposing a new intent:

1. Can it be expressed as a combination of existing intent + body context?
2. Would an agent benefit from filtering by this intent specifically?
3. Does it appear in >10% of commits in a typical project?

If all three answers are "yes", propose the addition as an ADR.
