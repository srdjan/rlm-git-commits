# Commit Format Specification

## Structure

A structured commit message has three sections separated by blank lines:

```
<header>

<body>

<trailers>
```

All three sections are strongly recommended. For truly minimal changes
(typo fixes, single-line config changes), body may be omitted but trailers
are always required. The blank line between body and trailers is mandatory
and enforced by the validator.

---

## Header

```
<type>(<scope>): <subject>
```

### Type

Standard Conventional Commits types. The type describes WHAT kind of change
was made at the code level:

| Type | Description |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code restructuring without behavior change |
| `perf` | Performance improvement |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `build` | Build system or external dependencies |
| `ci` | CI/CD configuration |
| `chore` | Maintenance tasks that don't fit above |
| `revert` | Reverting a previous commit |

### Scope (parenthetical)

The narrowest module or domain boundary affected. Use lowercase, hyphenated
names matching your project's module structure.

- Good: `auth`, `api/webhooks`, `orders/pricing`
- Bad: `src`, `backend`, `various`

### Subject

- Imperative mood: "add", not "added" or "adds"
- No period at the end
- Maximum 72 characters for the entire header line
- Lowercase first letter after the colon
- Should complete the sentence: "If applied, this commit will ___"

---

## Body

- Explain WHAT changed and WHY - not HOW (the diff shows how)
- Wrap lines at 72-80 characters for terminal readability
- Use present tense
- May include bullet points for multi-aspect changes (use `-` prefix)
- Separate multiple paragraphs with blank lines
- For spikes/explorations, include results and conclusions

---

## Trailers

Trailers are `Key: Value` pairs that appear after the body, separated from
it by a blank line. They follow the git trailer convention and are parseable
by `git interpret-trailers`.

### Required Trailers

#### Intent

```
Intent: <intent-type>
```

Exactly one value from the controlled vocabulary. Describes WHY this change
exists at a strategic level. See `intent-taxonomy.md` for the full taxonomy.

The Intent trailer is distinct from the Conventional Commits type:
- **Type** = what kind of code change (feat, fix, refactor)
- **Intent** = why this change exists (enable-capability, resolve-blocker)

A `refactor` type might have `Intent: improve-quality` (cleaning up code)
or `Intent: restructure` (architectural extraction) or even
`Intent: resolve-blocker` (refactoring to unblock another feature).

#### Scope

```
Scope: <domain/module>[, <domain/module>, ...]
```

Comma-separated list of affected domain paths. These should use your
project's domain vocabulary, not file paths.

Guidelines:
- Use 2-level paths: `<domain>/<subdomain>` (e.g., `auth/registration`)
- Maximum 3 scope entries per commit — more suggests the commit should be split
- Be consistent across the project — establish scope vocabulary early
- Cross-cutting concerns use the domain they primarily serve

### Header Scope vs Trailer Scope

The commit format has scope in two places, serving different purposes:

**Header scope** `feat(auth): ...` is the technical location in the
codebase. It is optimized for `git log --oneline` scanning and answers
"where in the repo?" It is a single value matching your directory or
module structure.

**Trailer Scope** `Scope: auth/registration, identity/agent` captures
domain and business area impact. It is optimized for semantic queries
and agent filtering, answering "what capabilities are affected?" It
accepts comma-separated values using domain vocabulary.

When they align (single-domain change):
```
feat(auth): add passkey registration

Intent: enable-capability
Scope: auth/registration
```

When they diverge (cross-cutting change):
```
refactor(orders): extract pricing engine from order aggregate

Intent: restructure
Scope: orders/pricing, orders/aggregate, quotes/pricing
```
Here the header scope is the primary code location (`orders`) while the
trailer lists all affected domain areas.

When both are the same, accept the redundancy. The header scope keeps
`git log --oneline` readable; the trailer scope enables structured
queries. Both are valuable.

### Optional Trailers

#### Decided-Against

```
Decided-Against: <approach> (<reason>)
```

**This is the highest-value trailer for agent memory.** When an agent or
developer considered an alternative approach and rejected it, recording
that decision prevents future agents from wasting time re-evaluating the
same options.

Multiple `Decided-Against` trailers are allowed (one per rejected approach):

```
Decided-Against: Redis pub/sub (no persistence guarantee)
Decided-Against: Kafka (operational overhead disproportionate to scale)
```

Format: `<noun-phrase approach> (<concise reason clause>)`

```
Good:  Redis pub/sub (no persistence guarantee)
Good:  Kafka (operational overhead disproportionate to scale)
Bad:   "We decided not to use Redis because..." (too verbose)
Bad:   Redis (missing reason - approach alone isn't useful)
```

Keep both parts concise - this is a signpost, not an ADR.

#### Session

```
Session: <YYYY-MM-DD>/<slug>
```

Groups commits from the same logical working session. The slug should be
descriptive enough to identify the session's goal.

Examples:
- `Session: 2025-02-08/passkey-lib`
- `Session: 2025-02-07/vector-search-spike`
- `Session: 2025-02-08/ci-optimization`

Agents use this to reconstruct the full context of a working session:
```bash
git log --grep='Session: 2025-02-08/passkey-lib'
```

#### Refs

```
Refs: <reference>[, <reference>, ...]
```

Pointers to related artifacts:
- Short commit SHAs: `abc123f`
- Issue numbers: `#1847`
- Document paths: `docs/adr/003-pricing-extraction.md`
- PR numbers: `!142` (for MR-style) or `#PR-142`

#### Context

```
Context: <compact-json>
```

A single-line JSON object for structured metadata that doesn't fit in
other trailers. Use sparingly — if you can express it as a named trailer,
prefer that.

Good uses:
- Benchmark results: `{"p50_ms":12,"p99_ms":45,"rows":"2M"}`
- Migration metadata: `{"from":"v2","to":"v3","tables":["users"]}`
- Quantitative impact: `{"loc_moved":340,"tests_added":12}`

Bad uses:
- Prose descriptions (belongs in body)
- Lists of files changed (that's what the diff is for)
- Duplicating information from other trailers

#### Breaking

```
Breaking: <description>
```

Describes a breaking change. Alternative to the `!` suffix in the header
(`feat(api)!: ...`) when more description is needed.

```
Breaking: /api/v2/users response shape changed from array to paginated object
```

---

## Trailer Ordering Convention

For consistency and scannability, trailers should appear in this order:

1. `Intent:`
2. `Scope:`
3. `Decided-Against:` (all instances)
4. `Breaking:`
5. `Session:`
6. `Refs:`
7. `Context:`

Required trailers first, then decision context, then metadata.

---

## Validation Rules

A well-formed structured commit satisfies:

1. Header matches `^(feat|fix|refactor|perf|docs|test|build|ci|chore|revert)(\(.+\))?: .+$`
2. Header length ≤ 72 characters
3. Body strongly recommended (may be omitted for trivial changes)
4. Blank line separates body from trailers (mandatory)
5. `Intent:` trailer present with valid taxonomy value
6. `Scope:` trailer present with at least one `domain/module` path
7. Scope entries use `domain/module` format (warning if no `/`)
8. No more than 3 scope entries (split signal)
9. Subject line uses imperative mood (heuristic: no `-ed`, `-ing` suffixes)
10. `Context:` value is valid JSON if present
11. `Session:` matches `\d{4}-\d{2}-\d{2}/.+` if present
