# Query Performance Reference

This document describes the performance optimizations available for querying structured git commits, what each optimization targets, and when to enable them.

## Two Optimization Tracks

The query system has two distinct performance bottlenecks addressed by different mechanisms:

1. **Path-based queries** (`git log -- path/to/file`) - accelerated by git commit-graph with changed-paths Bloom filters
2. **Content-based queries** (`--grep=`, intent/scope/session lookups) - accelerated by the trailer index

These are complementary. Neither substitutes for the other.

## Git Commit-Graph

### What it accelerates

- Path-based queries (`--path=scripts`): Bloom filters let git skip commits that definitely did not touch a path without unpacking tree objects. Speedup scales with repository size - roughly 2-30x for repositories with thousands of commits.
- Ancestry/reachability checks: `git merge-base --is-ancestor` uses generation numbers for O(1) boundary tests instead of graph traversal. The `--since-commit=HASH` flag in parse-commits.ts leverages this.
- Topological sorting: `git log --topo-order` benefits from precomputed generation numbers.

### What it does NOT accelerate

- `--grep` searches: These require reading commit message content regardless of graph topology. The commit-graph stores topology, not message text.
- `-S` (pickaxe) searches: These require reading diff content.
- Author/date filtering: Already fast with or without the graph.

### File location

`.git/objects/info/commit-graph` - binary format, not human-readable.

### Maintenance

```bash
# Write/update the graph (idempotent, safe to run repeatedly)
deno task graph:write

# Verify integrity
deno task graph:verify

# Check stats
deno task graph:stats
```

The graph should be rebuilt after large batches of commits (e.g., after a rebase, merge, or history rewrite). For normal development, git itself keeps the graph updated if `fetch.writeCommitGraph` is enabled:

```bash
git config fetch.writeCommitGraph true
```

### When to enable

- Repositories with 500+ commits where path-based queries are used regularly
- Any repository where `--since-commit` ancestry queries are needed
- Negligible cost: the graph file is small (a few KB for thousands of commits) and write is fast

## Trailer Index

### What it accelerates

- Intent filtering (`--intent=fix-defect`): O(1) hash list lookup instead of O(n) grep
- Session filtering (`--session=2025-02-08/feature`): O(1) lookup
- Scope filtering (`--scope=auth`): O(scope-keys) substring scan instead of O(n) grep
- Decision queries (`--decisions-only`): O(1) hash list lookup
- Decided-against keyword search (`--decided-against=redis`): Pre-filtered candidate set

### What it does NOT accelerate

- Path-based queries: These filter by file tree changes, not trailer content
- Full-text search in commit bodies: The index stores trailer values, not body text
- Code search (`-S`): Requires reading diffs

### File location

`.git/info/trailer-index.json` - human-readable JSON for inspection and debugging.

### Freshness model

The index stores the HEAD commit hash at generation time. When parse-commits.ts loads the index, it compares this against current HEAD. If they differ, the index is considered stale and the query falls back to the standard `git log --grep` path transparently.

### Maintenance

```bash
# Build/rebuild the index
deno task index:build

# Check if index is fresh (exit 0 if fresh, 1 if stale)
deno task index:check
```

Rebuild after any new commits. The index build is fast - it parses all commits in a single `git log` call.

### When to enable

- Repositories with 100+ structured commits where trailer-based queries are frequent
- When query latency matters (agent context reconstruction loops)
- Low cost: JSON file proportional to commit count, sub-second build times

## Combined Optimization

Run both optimizations together:

```bash
deno task optimize
```

This writes the commit-graph and builds the trailer index in sequence.

## Bypassing optimizations

If you suspect the index is producing incorrect results, bypass it:

```bash
deno task parse -- --intent=fix-defect --no-index
```

The `--no-index` flag forces the standard `git log --grep` path. Results should be identical - if they differ, the index has a bug.

## Scaling characteristics

| Query type | Without optimization | With optimization |
|---|---|---|
| `--intent=X` | O(n) grep over all commits | O(1) index lookup + O(k) fetch |
| `--scope=X` | O(n) grep | O(scope-keys) scan + O(k) fetch |
| `--session=X` | O(n) grep | O(1) index lookup + O(k) fetch |
| `--path=X` | O(n) tree walk | O(n) with Bloom filter skip |
| `--since-commit=HASH` | N/A | O(1) generation number check |

Where n = total commits, k = matching commits, scope-keys = number of distinct scope values.
