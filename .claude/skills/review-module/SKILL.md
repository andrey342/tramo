---
name: review-module
description: Review one module before a PR or after a phase - architecture and security reviewers in parallel, dependency rules and coverage restricted to the module - and deliver one report ordered by severity. Use when a module is feature-complete or after a large change to it.
argument-hint: <module>
allowed-tools: Agent, Bash(pnpm arch:check*), Bash(pnpm test:cov*), Bash(pnpm test:int*), Read, Grep, Glob
---

# Review a module

Arguments: `$ARGUMENTS` (module name, e.g. `iam`).

1. In parallel (one message, several tool calls):
   - the `arch-reviewer` agent on `src/modules/<module>/**` and its tests;
   - the `security-reviewer` agent on the same scope, plus `docs/architecture.md` for the
     policies the module claims to implement;
   - `pnpm arch:check`;
   - unit coverage of the module:
     `pnpm test:cov --collectCoverageFrom='src/modules/<module>/**/*.ts' --collectCoverageFrom='!src/modules/<module>/**/*.{spec,int-spec}.ts' --collectCoverageFrom='!src/modules/<module>/**/migrations/**' --coverageReporters=text --coverageThreshold='{}' src/modules/<module>`
     (persistence and HTTP are covered by `pnpm test:int` and `pnpm test:e2e`; add `--coverage`
     with the same filters to `pnpm test:int` when their coverage is in question).
2. Verify before reporting: open each finding's file and line and drop the ones that do not hold
   (a reviewer without the full picture can be wrong). Keep those you can explain with a concrete
   failure scenario.
3. One report, most severe first: severity, `path:line`, the problem, the scenario, the fix. Then
   coverage of `domain/` (must stay at 95 %) and `application/`, uncovered branches that matter,
   and a line per area found clean.
4. Fixes go on a `fix/<module>-review` branch, each with a test that fails without it.
