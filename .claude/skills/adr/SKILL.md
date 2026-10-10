---
name: adr
description: Record an architectural decision as the next MADR file in docs/adr and list it in docs/architecture.md. Use when a choice has real alternatives and consequences someone will ask about later (a library, a consistency model, a security trade-off).
argument-hint: '<title>'
allowed-tools: Bash(pnpm adr:new*), Read, Edit, Write
---

# ADR

Arguments: `$ARGUMENTS` (the decision as a short title, e.g. "Transactional outbox over direct
publish").

1. `pnpm adr:new "<title>"` creates `docs/adr/NNN-<slug>.md` with the next number, status
   `proposed` and today's date, and adds its row to the table in `docs/architecture.md`.
2. Write it in the repo's tone (see ADRs 004 and 013): the problem in a few sentences, the drivers,
   at least two real options, the decision and why, and consequences with the bad ones stated
   plainly together with how they are contained. No filler, no superlatives.
3. When the decision is in effect, set `Status: accepted` in the file and in the index row.
4. Link the ADR from the code or docs that depend on it only where a reader would otherwise ask
   "why is it done this way?".
