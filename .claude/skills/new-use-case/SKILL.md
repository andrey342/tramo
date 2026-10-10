---
name: new-use-case
description: Add a command or query to a module - handler, DTO, spec on in-memory fakes, registration in the module. Use for every new use case before writing its logic.
argument-hint: <module> <Name> --command|--query [--repository <Aggregate>]
allowed-tools: Bash(pnpm scaffold:use-case*), Bash(pnpm typecheck*), Bash(pnpm lint*), Bash(pnpm test*), Read, Edit, Write
---

# New use case

Arguments: `$ARGUMENTS`. `Name` is PascalCase without suffix (`SubmitApplication`, `ListPrograms`).

1. Run `pnpm scaffold:use-case <module> <Name> --command|--query [--repository <Aggregate>]`.
   - Command: `application/commands/<name>.command.ts` with the command class and its handler.
     With `--repository`, the handler loads the aggregate by id inside the unit of work, leaves a
     marked line for the transition and saves it (events reach the outbox with the save).
   - Query: `application/queries/<name>.query.ts` plus `application/dto/<name>.dto.ts`.
   - Spec next to it. With `--repository` it builds the handler on `InMemory<Aggregate>Repository`
     from `test/fakes/<module>.ts` (created if missing) and already covers "not found".
   - The handler is registered in `<module>.module.ts` after the other handlers.
2. Fill in the use case:
   - real fields on the command/query (validated in the HTTP DTO, not here);
   - the handler calls one aggregate method; rules and state checks live in the aggregate
     (`.claude/rules/domain.md`), the handler only orchestrates;
   - replace the `it.todo` with `should <behaviour> when <condition>` tests, including the error
     paths, using factories from `test/factories/<module>.ts`.
3. `pnpm typecheck && pnpm lint && pnpm test <module path>` must pass.

The `--repository` option needs the port to exist (`<AGGREGATE>_REPOSITORY` and
`<Aggregate>Repository` exported from `domain/index.ts`). If the generated code needs a manual fix
that is not the use case itself, fix `scripts/scaffold-use-case.ts` in the same commit.
