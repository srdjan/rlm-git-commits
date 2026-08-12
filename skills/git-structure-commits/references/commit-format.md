# Commit Format Specification

This format is Conventional Commits plus typed trailers, written to the seven
rules of a great commit message (Chris Beams, <https://cbea.ms/git-commit/>).
See "The Seven Rules" at the end for the rule-by-rule mapping and the one
deliberate divergence.

## Structure

A structured commit message has three sections separated by blank lines:

```
<header>

<body>

<trailers>
```

All three sections are strongly recommended. For truly minimal changes
(typo fixes, single-line config changes), body may be omitted but trailers
are always required. Both blank lines - after the header and before the
trailers - are mandatory and enforced by the validator.

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

- Imperative mood: "Add", not "Added", "Adding", or "Adds". The subject
  must complete the sentence "If applied, this commit will ___"
- Capitalized first letter after the colon: `feat(auth): Add passkey login`.
  The one exception is a subject that opens with a code identifier or flag
  (`parseCommit`, `--apply`), where the source spelling wins
- No period at the end
- 50 characters for the entire header line, including `type(scope): `.
  The validator warns above 50 and rejects above 72
- One line. If the subject needs a comma or "and", split the commit

The 50-character target is tight once the type prefix is spent, and that is
the point: a subject that does not fit is usually a commit that should be
split. Use the body for everything the subject cannot hold.

---

## Body

- Explain WHAT changed and WHY - not HOW (the diff shows how). Describe the
  behavior before the change, the behavior after, and the reason for it
- Hard-wrap every line at 72 characters. Git does not wrap body text, and it
  indents the message by 4 columns in `git log`
- Use present tense
- May include bullet points for multi-aspect changes (use `-` prefix)
- Separate multiple paragraphs with blank lines
- For spikes/explorations, include results and conclusions

Two exemptions from the 72-column wrap: fenced code blocks, and lines made of
a single unbreakable token such as a long URL or file path. Trailers are also
exempt - a `Decided-Against` or `Context` value may run past 72.

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
feat(auth): Add passkey registration

Intent: enable-capability
Scope: auth/registration
```

When they diverge (cross-cutting change):
```
refactor(orders): Extract pricing engine

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

| Rule | Severity |
|------|----------|
| Header matches `^(feat\|fix\|refactor\|perf\|docs\|test\|build\|ci\|chore\|revert)(\(.+\))?!?: .+$` | error |
| Header length ≤ 72 characters | error |
| Header length ≤ 50 characters | warning |
| Blank line separates subject from body | error |
| Blank line separates body from trailers | error |
| `Intent:` trailer present, exactly one, valid taxonomy value | error |
| `Scope:` trailer present with at least one path | error |
| `Context:` value is valid JSON if present | error |
| Subject starts with a capital letter (code identifiers exempt) | warning |
| Subject uses imperative mood (no `-ed`, `-ing`, or third-person `-s`) | warning |
| Subject does not end with a period | warning |
| Body present (waived for `chore`, `ci`, `build`) | warning |
| Body lines ≤ 72 characters (code fences and single tokens exempt) | warning |
| Scope entries use `domain/module` format | warning |
| No more than 3 scope entries (split signal) | warning |
| `Session:` matches `\d{4}-\d{2}-\d{2}/.+` if present | warning |

Run `deno task validate` to check a message against these rules.

---

## The Seven Rules

This format implements Chris Beams' seven rules
(<https://cbea.ms/git-commit/>):

| Rule | How this format applies it |
|------|----------------------------|
| 1. Separate subject from body with a blank line | Mandatory, enforced as an error |
| 2. Limit the subject line to 50 characters | Warning above 50, error above 72, measured across the whole header including `type(scope): ` |
| 3. Capitalize the subject line | The subject after the colon is capitalized; the type and scope stay lowercase |
| 4. Do not end the subject line with a period | Enforced as a warning |
| 5. Use the imperative mood in the subject line | Enforced by heuristic on the first word |
| 6. Wrap the body at 72 characters | Enforced as a warning, with code fences, single tokens, and trailers exempt |
| 7. Use the body to explain what and why vs. how | The body carries what and why; `Intent:` and `Decided-Against:` carry the why in queryable form |

**The one divergence:** rule 3 asks for a capitalized subject line, and
Conventional Commits requires a lowercase type token. This format keeps
both - `feat(auth): Add passkey login` - because the machine-readable
prefix and the human-readable sentence serve different readers. Capitalize
the sentence, not the prefix.

Rule 2's 50-character budget is measured across the whole header, prefix
included, so `type(scope): ` spends part of it. That is deliberate: the
prefix is what a reader scans in `git log --oneline`, so it counts against
the same line-width budget the rule exists to protect.
