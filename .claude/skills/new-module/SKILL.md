---
name: new-module
description: Scaffold a new bounded context (domain/application/infrastructure, Nest modules, schema migration) shaped like iam and registered everywhere it must be. Use when starting a module such as catalog, origination or lending.
argument-hint: <name> "<one-line responsibility>"
allowed-tools: Bash(pnpm scaffold:module*), Bash(pnpm arch:check*), Bash(pnpm typecheck*), Bash(pnpm lint*), Bash(pnpm test*), Read, Edit, Write
---

# New module

Arguments: `$ARGUMENTS` (module name in kebab-case, then its responsibility for the README map).

1. Dry run first and read the list of files it would touch:
   `pnpm scaffold:module <name> --responsibility "<text>" --dry-run`
2. Run it for real (same command without `--dry-run`). It writes:
   - `src/modules/<name>/domain/{index.ts,events/<name>-events.ts}`
   - `src/modules/<name>/<name>.module.ts`, `<name>-http.module.ts` (api only) and
     `<name>-worker.module.ts` (worker only: processors of the module's own queues)
   - `infrastructure/persistence/migrations/<stamp>-create-<name>-schema.ts`
   - registrations: `AppModule` (HTTP module), `WorkerModule` (worker module, which brings the module and its event consumers),
     `MODULES` in `queue-names.ts` (its `events.<name>` queue), `docker/postgres/init.sql`
     (schema) and the README module map.
     It formats what it wrote and finishes with `pnpm arch:check`. Dependency rules are written
     per layer and module path, so a new module needs no entry in `.dependency-cruiser.cjs`.
3. Run `pnpm typecheck`, `pnpm lint` and `pnpm test`; all must pass before anything else is added.
4. Report the files created and the next steps the script printed. Do not invent an aggregate:
   the domain model comes from the specification, then `/new-use-case` and `/add-adapter`.

If the script fails on a missing anchor, a file it edits has changed shape: fix the scaffold in
`.claude/skills/new-module/scripts/scaffold-module.ts` (or `.claude/lib/scaffold.ts`) in the same
commit, never hand-patch the output.
