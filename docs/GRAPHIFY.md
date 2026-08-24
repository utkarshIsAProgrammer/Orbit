# GRAPHIFY — Knowledge Graphs for AI Agents

Graphify turns the codebase into a **queryable knowledge graph** that AI
coding assistants (Claude Code, Codex, Cursor, and anything reading
`.agents/skills/`) can traverse instead of grepping files. Installed at
**three levels** so any agent working in any folder has the map:

| Location | Scope | Graph size |
|---|---|---|
| **root** (`/projects/orbit`) | Entire monorepo (client + server + docs) | 3,600 nodes · 9,108 edges · 245 communities |
| **client/** | Frontend only (React, Vite, PWA) | 1,073 nodes · 2,494 edges · 86 communities |
| **server/** | Backend only (Express, Mongoose, BullMQ) | 2,060 nodes · 6,028 edges · 145 communities |

---

## What was installed

Each of the three folders has:

```
.agents/skills/graphify/          # the /graphify skill (agent instructions)
graphify-out/                     # generated output (gitignored)
├── graph.json                    # the queryable graph (4-9 MB)
├── graph.html                    # interactive visualization (open in a browser)
├── GRAPH_REPORT.md               # human-readable map: hubs, communities, freshness
├── manifest.json
└── cache/                        # AST extraction cache (speeds up rebuilds)
```

- **`.agents/skills/` is committed** — agents need the skill file to know how to query.
- **`graphify-out/` is gitignored** — it's regenerable output (~17 MB total).

---

## How an AI agent uses it

The skill's **fast path**: if `graphify-out/graph.json` exists, a natural-language
question about the codebase skips extraction entirely and runs:

```bash
graphify query "How does feed ranking work?"       # BFS traversal, broad context
graphify query "..." --dfs                         # trace a specific path
graphify path "AuthModule" "Database"              # shortest path between two nodes
graphify explain "feedService.ts"                  # what a node is + its neighbors
graphify affected "post.controllers.ts"            # what breaks if I change X
graphify god-nodes                                 # the architectural hubs
```

The CLI lives at `~/.local/venvs/graphifyy/bin/graphify` (installed via a
dedicated venv — no system packages touched). Agents auto-detect it via the
skill's interpreter-detection logic; if you ever see it fail to import,
check `graphify-out/.graphify_python` holds the venv path.

---

## Rebuilding after code changes

```bash
export PATH="$HOME/.local/venvs/graphifyy/bin:$PATH"

# Re-extract changed files + rebuild (no LLM needed, seconds)
cd <root | client | server>
graphify update .

# After a refactor that DELETED code, the graph shrinks — force the overwrite:
graphify update . --force
```

The graph records the commit it was built from — `GRAPH_REPORT.md` shows it
and tells you to compare `git rev-parse HEAD` to know if the graph is stale.

### Optional: semantic enrichment

The basic build is pure AST (free, fast). Setting `GEMINI_API_KEY` in the
environment makes Graphify also do semantic extraction + name the 200+
communities with real labels instead of placeholders:

```bash
export GEMINI_API_KEY=...   # then: graphify label <path>   or rebuild with the key set
```

Community labeling is a one-time nicety — the graph is fully queryable without it.

---

## The one caveat

`graphify update` reported 2 partial-extraction warnings for
`client/src/landing/components/Hero.tsx` (and a duplicate in the
`landingpage/` experiment folder) — JSX syntax the AST parser tripped on.
That file is a landing page; the graph still extracted its imports/edges,
just fewer symbols. Not a problem in practice, just noted for honesty.

---

## Keeping it fresh

Add `graphify update .` to your pre-deploy checklist (or run the three
commands after each merge). The graphs are stale the moment code changes —
rebuilding is the difference between an agent answering from the current
code vs. last week's.
