# 011. Versioned coding-agent tooling

- Status: accepted
- Date: 2026-10-10

## Context and problem statement

Most changes in this repo follow a handful of procedures: add a module, add a use case, add an
adapter with its fake, write and verify a migration, record an ADR, inspect a stuck job, follow an
aggregate through the outbox and the queues. Done by hand, each one is a checklist that is easy to
get half right (a module missing from the dependency rules, a migration whose `down` was never run,
a fake that drifts from the real adapter). Contributors may work with a coding agent. Where should
these procedures and conventions live so that both a person and the agent apply them the same way?

## Decision drivers

- Conventions must be enforced where possible, not only written down.
- Every procedure must be runnable without the agent (plain `pnpm` scripts).
- Guidance must stay short: what applies to migrations should not be loaded while editing a
  controller.

## Considered options

1. Conventions in the README and `docs/` only.
2. Conventions plus versioned agent configuration: a short project conventions file, rules scoped
   by path, skills that wrap scripts, read-only review agents, hooks and permissions, and MCP
   servers for library docs and the local database.

## Decision outcome

Option 2. The pieces and where they live are listed in the README under "Developer tooling". The
split follows what each mechanism can do that the others cannot:

- The conventions file is a map: commands, the four architecture principles, the workflow and an
  index of skills. Detail lives in path-scoped rules (domain, migrations, HTTP, tests).
- Skills hold procedures. Each one wraps a script under `scripts/` that also runs on its own
  (`pnpm scaffold:module`, `pnpm verify:migration`, ...). Module templates are derived from `iam`,
  the reference module. When a skill produces something that needs a manual fix, the skill is fixed
  in the same commit.
- Review agents run with read-only tools and a fixed checklist (architecture, security).
- Hooks and permissions are deterministic guardrails: edited files are formatted and linted, force
  pushes, `schema:sync` and deleting compose volumes are denied.
- MCP servers give access to current library documentation and a read-only Postgres role
  (`tramo_ro`) for query plans and hypothetical indexes.

### Consequences

- Good: scaffolding produces code that already passes `lint`, `typecheck` and `arch:check`, so new
  modules start consistent with `iam`.
- Good: the scripts double as documentation of each procedure and work in CI or a terminal.
- Bad: the templates must follow changes to `iam`. A template that drifts shows up as a failing
  `lint`, `typecheck` or `arch:check` the next time it is used.
- Bad: one more set of files to keep current; they are reviewed like any other code.
