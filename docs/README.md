# 📚 ORBIT — Documentation Index

> The reference docs for running, operating, and developing ORBIT.
> For *learning* the codebase (concepts + file-by-file explanations), see
> **`roadmap/`** — this folder is the day-to-day reference.

---

## Reference docs

| Doc | What it's for |
|---|---|
| [`STACK.md`](STACK.md) | Full stack + technologies + deployment architecture + env vars |
| [`ENV.md`](ENV.md) | Every environment variable (backend + frontend), mandatory → optional |
| [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md) | What you can do as admin and how (dashboard, flags, moderation, make-admin) |
| [`FEATURES.md`](FEATURES.md) | The complete feature catalog |
| [`FEATURES_STATUS.md`](FEATURES_STATUS.md) | Feature audit: what's implemented, wired, or removed (re-run to verify) |
| [`GESTURES.md`](GESTURES.md) | The gesture-first UI: every touch gesture + haptics |
| [`API_REFERENCE.md`](API_REFERENCE.md) | Endpoint inventory by feature area + auth requirements |
| [`DATABASE.md`](DATABASE.md) | The 35 models: purpose, key fields, indexes, TTLs, repair scripts |
| [`RUNBOOK.md`](RUNBOOK.md) | Operations: deploy, logs, queue health, incident responses |
| [`BACKUP_AND_RECOVERY.md`](BACKUP_AND_RECOVERY.md) | Backup strategy + restore procedure ⚠️ read before it's needed |
| [`MONITORING.md`](MONITORING.md) | Sentry / Logtail / queue observability setup |
| [`TESTING.md`](TESTING.md) | How the test suite works + how to run it |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Conventions for adding features / fixing bugs |
| [`CHANGELOG.md`](CHANGELOG.md) | Release notes |
| [`QUICKSTART.md`](QUICKSTART.md) | Run the full stack locally in 5 minutes |
| [`GRAPHIFY.md`](GRAPHIFY.md) | AI-agent knowledge graphs (root/client/server), how to query + rebuild |

## Other

- `orbit.docx` — product retention strategy memo (non-technical).
- `roadmap/` — the full learning curriculum (16 files): read `roadmap/00-README.md` first.

## Rule

**Keep these in sync with the code.** If you add an env var → update `ENV.md`
and `STACK.md`. Add a feature → `FEATURES.md`. Change a model → `DATABASE.md`.
Fix an incident → `RUNBOOK.md`. The audit in `FEATURES_STATUS.md` and the
`roadmap/01-project-map.md` are re-runnable checks.
