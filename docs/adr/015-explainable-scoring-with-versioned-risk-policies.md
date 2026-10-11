# 015. Explainable scoring with versioned risk policies

- Status: accepted
- Date: 2026-10-11

## Context and problem statement

Every application is approved, sent to an analyst or rejected by a score built from the program's
employability, the applicant's employment history, how affordable the payment is and a credit
bureau score, after a few rules that reject outright (age, residence, identity, default
registries, amount). A student who is turned down can ask why, ops must be able to defend a
decision months later, and risk wants to tune weights and thresholds without a deployment.
Where do the rules live, and how is a past decision explained once they have changed?

## Decision drivers

- Explainability: the reasons of a decision are those of the rules in force when it was made.
- Rules changed by an admin at runtime, with an audit trail, not by a release.
- The scoring itself testable exhaustively, without IO or time.
- No rules engine or scoring service to run and secure.

## Considered options

1. Weights and thresholds as configuration (environment variables); the decision stores the
   score only.
2. A rules engine (or an external scoring service) evaluating rules kept in its own store.
3. A pure domain function (`ScoringEngine`) applying an immutable, versioned `RiskPolicy` read
   from the database, storing with each application a `DecisionRecord`: score, every factor with
   its weight and value, the hard rules broken, readable reasons and the policy version.

## Decision outcome

Option 3. The engine is plain TypeScript over value objects (`Money`, `Percentage`): the same
input always gives the same decision, and its unit tests cover every rule and both sides of each
threshold. Policies live in `origination.risk_policies`, one row per version; an admin publishes
the next version (`POST /risk-policies`, audited) and the highest version is in force. Version 1
is seeded by the migration that creates the table. `GET /applications/:id/decision` returns the
record to the student and to ops.

Option 1 needs a restart to change a threshold and cannot explain an old decision once the
variables change. Option 2 adds a component whose rules are harder to test and to review than a
hundred lines of code, for a model with four factors.

### Consequences

- Good: a decision can always be explained with the rules of its day, since the record names the
  version and carries the factors it was computed from.
- Good: changing the policy is a request, validated by the same aggregate (weights add up to
  100 %, review threshold below approval) and recorded in the audit log.
- Bad: rules that are not a weight, a threshold or one of the five hard rules need code. That is
  intended: a new kind of rule deserves review and tests, not a form.
- Bad: two admins publishing at once both build the same next version; the second insert hits the
  primary key and is answered as a conflict, to be retried on top of the new version.
