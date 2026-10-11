---
name: add-adapter
description: Add an implementation of a port (application/ports or domain/ports) with a stubbed class, the shared contract suite, a fake if the port has none, and specs that run the contract against both. Use for every new adapter (VIES client, SMTP sender, PSP, e-signature).
argument-hint: <module> <Port> <name> [--integration] [--runtime-fake] [--token <NAME>]
allowed-tools: Bash(pnpm scaffold:adapter*), Bash(pnpm typecheck*), Bash(pnpm lint*), Bash(pnpm test*), Read, Edit, Write
---

# Add adapter

Arguments: `$ARGUMENTS`. `Port` is the interface name (`VatValidator`), `name` the technology in
kebab-case (`vies`), giving `ViesVatValidator`.

1. Run `pnpm scaffold:adapter <module> <Port> <name>`; add `--integration` when the adapter talks
   to something real (database, HTTP service, SMTP), so its contract run is an `.int-spec.ts`.
   The script reads the port with the TypeScript compiler and writes:
   - `infrastructure/adapters/<name>-<port>.ts`: one stub per port member, with the types the
     signatures use already imported;
   - `test/contracts/<port>.contract.ts` (if missing): `<port>Contract(name, create)`, the
     behaviour every implementation shares;
   - a fake in `test/fakes/<module>.ts` when the port has none, or, with `--runtime-fake`, in
     `infrastructure/adapters/fake-<port>.ts` registered in the module: for providers whose fake is
     chosen by configuration (e2e, offline demo), such as VIES or the PSP;
   - `<port>.contract.spec.ts` (fake, and the adapter unless `--integration`) and
     `<port>.contract.int-spec.ts` (adapter, with `--integration`);
   - the adapter as a provider of `<module>.module.ts`.
     The injection token is `<PORT_NAME>` by convention; pass `--token` for older ports.
2. Write the contract first (`should <behaviour> when <condition>`), then make the fake and the
   adapter pass it. Real adapters need resilience where they cross the network: timeouts,
   retries with backoff only for idempotent calls, and a typed error the domain understands.
3. Choose the implementation in the module. When it must switch by environment, apply the
   snippet the script prints (env var in `env.schema.ts`, field in `app-config.ts`, factory
   provider) and document the variable in `.env.example` and the README.
4. `pnpm typecheck && pnpm lint && pnpm test` (and `pnpm test:int` with `--integration`).

An adapter named after another module (`catalog`, `iam`) asks that module through its public
query; its integration contract run goes to `test/integration/<port>.int-spec.ts`, which may boot
both modules (module code may not import another module's internals).

The script notes runs it could not generate (a contract that takes more than a factory, a fake
whose constructor needs an unknown dependency); write those by hand. A wrong generated file is
fixed in `scripts/scaffold-adapter.ts` in the same commit.
