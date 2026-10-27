---
name: mowo-project
description: Plan, build, review, document, test, or operate the MOWO Canvas project. Use for any task inside this project; routes work to the minimum current documentation while excluding abandoned designs and unrelated history.
---

# MOWO Canvas Project Skill

Use the project root as the working directory. Start every task by reading `../../../PROJECT_STATUS.md`, then load only the documents required by the routing table below. Do not read all project documents.

## Task routing

| Task | Read after project status |
|---|---|
| Product goals or feature scope | `../../../docs/01-project-overview.md`, `../../../docs/02-product-scope.md` |
| Milestone or iteration planning | `../../../docs/03-roadmap.md` |
| Architecture, dependencies, module boundaries | `../../../docs/04-architecture.md` |
| Database, persistence, import/export, assets | `../../../docs/05-data-design.md` |
| Canvas, nodes, edges, viewport, shortcuts | `../../../docs/06-canvas-design.md` |
| Find or add project files | `../../../docs/07-file-map.md` |
| Implement, test, or commit changes | `../../../docs/08-development-guide.md` plus the feature document |
| Local setup, launch, or update | `../../../docs/09-local-deployment.md` |
| Public or cloud deployment | `../../../docs/10-future-online-deployment.md`, `../../../docs/11-security-and-backup.md` |
| Backup, recovery, upload, security | `../../../docs/11-security-and-backup.md` |
| Evaluate or import a starter/template | `../../../docs/12-template-selection.md` |
| Authentication, users, teams, permissions | `../../../docs/13-account-system-plan.md` |
| Explain why an accepted direction exists | `../../../docs/decisions/README.md`, then only the named ADR |

Paths above are relative to this `SKILL.md`.

## Current-truth rules

- Treat `PROJECT_STATUS.md` and numbered topic documents as current truth.
- Never load `../../../docs/archive/` unless the user explicitly asks to inspect, compare, recover, or summarize history.
- Do not resurrect an abandoned option because it appears in Git history, logs, or archives.
- Keep one authoritative location per rule; link instead of duplicating content.
- If code and current docs disagree, inspect the code and relevant evidence, then resolve the mismatch before extending the design.

## Change workflow

1. Confirm the requested work is inside the current product scope. If it changes scope, update scope and roadmap only after user agreement.
2. Inspect the Git worktree and preserve unrelated user changes.
3. Before a design experiment or broad refactor, create a recoverable Git checkpoint or isolated branch.
4. Make the smallest coherent change and verify it in proportion to risk.
5. If accepted, update only the affected current document and `PROJECT_STATUS.md`; update `CHANGELOG.md` only for a stable delivered version.
6. If abandoned, restore the pre-experiment checkpoint. Remove the experiment from current docs and the current log. Archive details only when the user explicitly wants them retained.

## Documentation economy

- Keep `PROJECT_STATUS.md` short enough to read on every task.
- Do not add routine implementation details to architecture documents.
- Do not create ADRs for ordinary code changes; use them for accepted decisions with lasting consequences.
- Keep `docs/logs/current.md` limited to the active iteration and observable verification.
- Update `docs/07-file-map.md` only for maintained source or configuration structure, never generated files or user data.

## Project boundaries

- The current product is local-first and single-user.
- Do not add authentication, cloud hosting, AI generation, billing, collaboration, or overseas service dependencies unless the user moves that capability into scope.
- Prefer self-hostable and China-accessible choices when a future external dependency is evaluated.
- Do not install a full SaaS starter. Evaluate focused templates under `docs/12-template-selection.md`.
