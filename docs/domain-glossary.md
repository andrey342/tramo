# Domain glossary

The ubiquitous language of Tramo, by bounded context. Names are written as the code spells them
(class, type, status or event name); states and transitions are those the aggregates enforce.
Architecture and decisions are in [`architecture.md`](architecture.md) and [`adr/`](adr).

## Shared terms

- **`Money`**: an amount in integer cents (ADR 005), currency `EUR` only. Arithmetic between
  amounts stays in integers; multiplying by a rate goes through decimal.js and rounds back half-up
  to the cent by default. Columns and payloads carry it as `*_cents` / `*Cents`.
- **`Percentage`**: a rate in integer basis points (1 bp = 0.01 %): interest rates, income shares,
  platform fees, employability. Payloads carry it as `*BasisPoints`.
- **TIN / TAE**: the nominal annual rate of an instalment loan (`annualRate`) and the annual
  percentage rate derived from it (`annualPercentageRate`, `(1 + TIN/12)^12 − 1`, no fees
  included). Offers show both (`annualRateBasisPoints`, `aprBasisPoints`).
- **`CalendarDate`**: a day without time or zone (`2026-10-12`). Due dates, billing periods
  (`YYYY-MM`) and the ISA window are days; an instant becomes a day in UTC.
- **`Clock`**: the port time comes from (ADR 009); the domain never calls `new Date()`.
- **`DomainEvent`**: a fact that already happened, named in the past tense
  (`ApplicationSubmitted`), with a plain JSON payload. Each module publishes its events in
  `domain/events/*-events.ts`; other modules read the payload, never the aggregate.
- **Outbox**: `shared.outbox_messages`. An aggregate's events are written in the same transaction
  as its change (ADR 004). The worker's `OutboxPublisher` claims unpublished rows
  (`FOR UPDATE SKIP LOCKED`), adds one job per subscriber and marks them `published_at`. Rows are
  kept after publishing: they are the event history reporting replays (ADR 019).
- **`IntegrationEvent`**: what a consumer receives, the stored event plus `eventId` (the outbox
  row id, stable across redeliveries) and `correlationId`.
- **Consumer**: a handler of one event type, named `<module>.<name>`
  (`origination.start-verification`). Its jobs go to `events.<module>` with job id
  `<eventId>.<consumer>`. It claims the event in `shared.processed_events` in the same unit of
  work as its effects, so a redelivered event is applied once.
- **Work queue**: a module's own queue for jobs with their own retry schedule or that call a
  provider outside a transaction (`catalog.vat-checks`, `origination.verifications`,
  `lending.disbursements`, `billing.collect`, `notifications.webhooks`...).
- **Dead-letter queue**: `dead-letter`. A job that exhausted its attempts (or failed with an
  `UnrecoverableError`) is copied there with its queue, job id, data and reason; the original
  stays in its queue's failed set.
- **Request id / correlation id**: every request gets an id (`X-Request-Id` when the caller sends
  a well-formed one, otherwise a UUIDv7), returned in `x-request-id` and in Problem Details as
  `requestId`. Outbox rows written by the request store it as `correlation_id`, and jobs run with
  it as their context id, so log lines (`correlationId`) of the request and of the jobs it caused
  share it. A job not caused by a request uses `<queue>.<jobId>`.
- **Idempotency-Key**: the header required by endpoints marked `@Idempotent()`. The completed
  response is kept 24 h and replayed (`Idempotent-Replayed: true`); a concurrent duplicate gets
  409; the same key with a different request gets 422.
- **Audit log**: `shared.audit_log`, one row per call of an `@Audited` endpoint (actor, action,
  resource, outcome, error code, request id, described changes), failures included.
- **Problem Details**: every error response (RFC 9457, ADR 006) with a stable `code`
  (`payoff_quote_changed`, `too_many_requests`...).
- **`Role`**: `student`, `center_admin`, `ops`, `admin`. `ops` and `admin` are staff.
- **`ApiKeyScope`**: what a center's API key may do: `applications:read`, `applications:write`,
  `programs:read`, `programs:write`, `portfolio:read`.

## iam

- **`User`**: an account with roles of one kind only: a student, a center user (`center_admin`,
  always bound to one center) or staff. `UserStatus`: `active | disabled`; an admin disables an
  account, which also revokes every refresh token family it has.
- **`RefreshToken`** and family: refresh tokens are opaque, stored hashed and single use; each
  refresh rotates the presented token into the next one of the same family. `RefreshTokenStatus`:
  `active → rotated` (used) or `revoked`. A rotated token presented again more than 10 s
  (`REUSE_GRACE_MS`) after its rotation revokes the whole family and publishes
  `RefreshTokenReuseDetected`; within those 10 s it is only rejected (`superseded`). A family
  ends `SESSION_MAX_DAYS` after sign-in.
- **`ApiKey`**: a center's integration credential, `tramo_<8 hex prefix>_<secret>`, shown once,
  stored as a hash, with at least one scope. Revoked keys keep `revokedAt`. Suspending a center
  revokes all its keys, and a suspended center gets no new ones.
- **Lockout**: failed sign-ins counted per account in Redis. See the runbook for durations.
- Events: `StudentRegistered`, `CenterUserCreated`, `UserDisabled`, `ApiKeyIssued`,
  `ApiKeyRevoked`, `RefreshTokenReuseDetected`.

## catalog

- **`TrainingCenter`**: a school or bootcamp whose programs students finance. Registered by an
  admin with a VAT number, a payout IBAN and a platform fee.

  ```text
  pending_verification → active            a VAT check answers valid
  any but suspended → suspended            an admin, with a reason (CenterSuspended)
  suspended → active                       reinstated with a valid VAT number (CenterActivated)
  suspended → pending_verification         reinstated without one (CenterReturnedToVerification,
                                           which queues a new VAT check)
  ```

  Only an active center publishes programs and receives disbursements. An admin corrects the VAT
  number of a center that is not active (`CenterVatNumberChanged`): its validation is dropped and
  the new number is checked as on registration.

- **`VatValidation`** / **`VatCheckResult`**: the latest VAT check kept on the center, with status
  `valid | invalid | unverified`. A check answers `valid`, `invalid` or `unavailable` (VIES could
  not be asked: down, timeout, circuit open). `unavailable` marks a center never checked (or
  still unverified) as `unverified` and changes nothing else; `valid` activates a center pending
  verification; `invalid` is recorded and leaves the status alone, and on a number that was valid
  emits `CenterVatInvalidated` for ops to decide.
- **Platform fee** (`platformFee`): Tramo's commission on what it disburses to the center, at most
  30 % (`MAX_PLATFORM_FEE_BPS`). The student does not pay it.
- **Payout IBAN**: the account disbursements are paid into, stored encrypted (ADR 014); only its
  last four characters are shown.
- **`Program`**: a course of a center that students apply to finance (price, duration, modality
  `online | onsite | hybrid`, start dates, `employabilityRate`, `avgStartingSalary`).

  ```text
  draft → published                        its center is active and it has a financing option
  draft | published → archived             (ProgramArchived only when it was published)
  archived → published                     corrected and published again
  ```

- **`FinancingOptions`**: the ways a program can be financed, at least one to publish:
  - **`InstallmentsOption`**: a loan in equal monthly instalments, `allowedTerms` (1 to 12
    different terms, each 6 to 48 months) at an `annualRate` (TIN) of at most 25 %.
  - **`IsaOption`**: an income share agreement. Once earning at least `minMonthlyIncome`, the
    graduate pays `incomeShare` (above 0 %, at most 20 %) of their monthly income for at most
    `maxPayments` months (1 to 120), never more in total than `capMultiplierHundredths` times the
    price (100 to 200, i.e. 1.0 to 2.0 times), starting after `graceMonths` (0 to 12). Only
    offered when `employabilityRate` is at least 60 %.
- Events: `CenterRegistered`, `CenterActivated`, `CenterSuspended`, `CenterRenamed`,
  `CenterPlatformFeeChanged`, `CenterPayoutAccountChanged`, `CenterVatInvalidated`,
  `CenterVatNumberChanged`, `CenterReturnedToVerification`, `ProgramPublished`, `ProgramDetailsChanged`, `ProgramFinancingChanged`, `ProgramArchived`.

## origination

- **`FinancingApplication`**: a student's request to finance one program with one product
  (`RequestedProduct`: `installments` with a `termMonths`, or `isa`). Started by the student or by
  the center's API key (`ApplicationOrigin`: `student | center`); only the student submits,
  accepts and cancels.

  ```text
  draft → submitted                        the student submits a complete profile
  submitted → verifying                    the first provider answer is recorded
  verifying → scoring                      the third answer is recorded
  scoring → approved | needs_review | rejected      the scoring engine decides
  needs_review → approved | rejected       an ops analyst, with a reason
  approved → offer_accepted                the student accepts; lending takes over
  offer_accepted → withdrawn               lending's ContractCancelled (declined or never signed)
  offer_accepted → closed                  lending's ContractCompleted (the contract ran its course)
  any non-final → cancelled                the student cancels
  any non-final but needs_review → expired 14 days without a change (hourly sweep)
  ```

  Final states: `rejected`, `offer_accepted`, `cancelled`, `expired`, `withdrawn`, `closed`; only
  the consumers of lending's events move an accepted offer on. A student has at most one open
  application per program: every final state but `offer_accepted` frees it, so an accepted offer
  holds the program until its contract is cancelled (`withdrawn`) or completed (`closed`). A
  defaulted contract keeps it held: the debt for that course is in collection.

- **`ApplicantProfile`**: what the student declares: `dateOfBirth`, `nationalId` (encrypted,
  shown masked), `residenceCountry`, `declaredMonthlyIncome`, `employmentStatus`
  (`employed | self_employed | unemployed | student`). A draft may leave fields empty; submitting
  needs all of them.
- **`ProgramSnapshot`**: the program (price, employability, salary, options) copied from the
  catalog when the draft starts and again on submit, so later catalog changes do not alter an
  application in flight.
- **Verification**: one answer per provider type (`VERIFICATION_TYPES`: `kyc`, `employment`,
  `bureau`), each run by a job on `origination.verifications` (`kyc.verify`, `employment.fetch`,
  `bureau.check`, job id `<applicationId>.<type>`). `KycResult` (verified, confidence),
  `EmploymentResult` ("vida laboral": months worked of the last 24, currently employed, current
  income), `BureauResult` (listed in a default registry, score 0 to 1000). Recording an answer is
  idempotent per provider and emits `VerificationCompleted` with how many remain.
- **`RiskPolicy`**: the rules and thresholds of scoring, versioned and immutable; the highest
  version is in force and every decision records the one it used. It holds `maxFinanceable`,
  `minAgeYears`, `allowedResidenceCountries`, factor `weights` (adding up to 100 %) and the
  `approveThreshold` / `reviewThreshold`. Version 1 (seeded by the migration): up to 12,000 EUR,
  18+, residents of ES, weights 40/25/20/15, approve from 70, review from 50. `revise` makes the
  next version.
- **`ScoringEngine`**: a pure function of the application, its three verifications and the
  policy that returns a `DecisionRecord`.
- **Hard rules** (`HARD_RULES`): `underage`, `residence`, `identity_not_verified`,
  `default_registry`, `amount_above_limit`. Any broken rule rejects, whatever the score.
- **Score and factors**: 0 to 100 (two decimals), the weighted sum of four factors
  (`SCORE_FACTORS`), each valued 0 to 1: `employability` (the program's rate),
  `employment_history` (months worked of the last 24), `affordability` (1 minus the estimated
  payment over the income, where the income is the declared one capped by the employment record;
  for an ISA, 1 minus the share) and `bureau` (bureau score / 1000). Each `ScoreFactor` keeps its
  weight, value and points.
- **`DecisionRecord`**: why the engine decided: outcome (`approved | needs_review | rejected`),
  score, factors, hard rules broken, readable reasons, estimated monthly payment, policy version
  and time. Students and staff see it; centers do not.
- **`ManualDecision`**: an analyst's `approved` or `rejected` on an application in `needs_review`,
  with a reason of 1 to 500 characters; an analyst cannot decide their own application.
- **Rejection codes**: the hard rules broken, `score_below_threshold` or `analyst_decision`, in
  `ApplicationRejected`.
- **Offer**: the terms of an approved application as the student sees them (`OfferTermsDto`):
  for instalments the term, TIN, TAE and monthly payment; for an ISA the share, minimum income,
  maximum payments, cap in cents and grace months. There is no separate offer aggregate:
  accepting it moves the application to `offer_accepted` and publishes `OfferAccepted` with the
  accepted terms, which lending draws the contract from. An approval past its expiry cannot be
  accepted.
- Events: `ApplicationSubmitted`, `VerificationCompleted`, `ApplicationApproved`,
  `ApplicationNeedsReview`, `ApplicationRejected`, `OfferAccepted`, `ApplicationCancelled`,
  `ApplicationExpired`, `ApplicationWithdrawn`, `ApplicationClosed`.

## lending

- **`Contract`**: the agreement drawn up from an accepted offer, one per application. Its terms
  never change after it is drawn.

  ```text
  draft → sent_for_signature → signed → active → completed
  draft | sent_for_signature → cancelled   signature_declined | signature_expired
  active → in_arrears                      billing's ContractInArrears (30 days overdue)
  in_arrears → active                      billing's ArrearsCleared
  active | in_arrears → defaulted          billing's ChargeWrittenOff (90 days overdue)
  active | in_arrears → completed          the plan ended (PlanCompleted)
  ```

  Arrears notices older than the last change are ignored, and an ended contract (`completed`,
  `defaulted`) ignores them.

- **`ContractTerms`**: fixed at drawing: `principal` (the program price, financed in full), the
  center's `platformFee` at that moment and the `ContractProduct` (instalments: term and TIN;
  ISA: share, minimum income, maximum payments, cap multiplier, grace months).
- **Signature envelope** (`Signature`): what was sent to the e-signature provider: provider,
  `envelopeId`, the rendered `document` as sent, its SHA-256 `documentHash`, `sentAt` and, once
  signed, `signedAt`. A callback for another envelope or another hash is refused
  (`signature_mismatch`); a signing time outside the envelope's life is refused.
- **`Disbursement`**: the payment of a signed contract's principal less the platform fee to the
  center, one per contract.

  ```text
  pending → sent → settled
  pending → failed                         only before the transfer started
  sent → failed                            the bank refused it
  failed → pending                         ops retry, as a new attempt
  ```

  Each attempt has the idempotency key `<disbursementId>.<attempt>` and fixes its `Creditor`
  (IBAN, holder) before the bank is called; from then on only the bank's answer can fail it.

- **`FinancingPlan`**: how an active contract is repaid, opened on `ContractActivated` (ADR 016).
  `PlanStatus`: `active → completed`, with a completion reason `repaid`, `paid_off`,
  `cap_reached`, `max_payments`, `window_expired` (`PlanCompleted` completes the contract) or
  `defaulted` (the contract defaulted first, `ContractDefaulted` closes the plan; the contract
  stays `defaulted`).
  - **Instalment schedule** (`InstallmentRow`): French amortisation, a constant instalment with
    each row's interest rounded half-up and the rounding absorbed by the last row. Instalments
    fall due on the activation day of each following month (days 29 to 31 move to the 28th).
    Paid instalments are recorded in any order; the plan is `repaid` when all are.
  - **ISA periods**: calendar months from the first full month after the grace period (counted
    from the program's end, taken as activation plus its duration) until the window closes,
    8 years after the program's end. Each month is assessed in order, none skipped
    (`assessPeriod`): with income declared at or above the minimum it is charged the share,
    never past the cap; below the minimum or without a declaration it is `paused`. Two months in
    a row without a declaration publish `IsaDeclarationOverdue`, once until a declaration clears
    it: the student is emailed (`isa_declaration_overdue`) and staff see `declarationOverdue` on
    the contract's schedule (`GET /contracts/:id/schedule`); the ops overview does not count it.
    The plan ends at the cap, at `maxPayments` or once a month starts after the window.
- **Payoff / payoff quote** (`PayoffQuote`): instalments only. What repaying everything costs on
  a day: instalments due and unpaid, the outstanding principal and the interest accrued since the
  last due date, no fee. `POST /contracts/:id/payoff` takes today's quote and records a
  `PayoffRequest` (`PayoffRequested`); another amount is refused with `payoff_quote_changed`, and
  a payoff is refused while an instalment due is unpaid. Collected, the plan ends as `paid_off`;
  refused by the provider, it is withdrawn (`PayoffWithdrawn`) and the plan goes on.
- Events: `ContractCreated`, `ContractSentForSignature`, `ContractSigned`, `ContractCancelled`,
  `ContractActivated`, `ContractCompleted`, `ContractDefaulted`, `DisbursementRequested`,
  `DisbursementSent`, `DisbursementSettled`, `DisbursementFailed`, `DisbursementRetried`,
  `PayoffRequested`, `PayoffWithdrawn`, `IsaDeclarationOverdue`, `PlanCompleted`.

## billing

- **`PaymentMandate`**: the student's SEPA direct debit authorisation for one contract, with an
  encrypted IBAN and a reference `TRAMO-<16 chars>`. `MandateStatus`: `active → revoked`; signing
  a new mandate revokes the one in force.
- **`Charge`**: an amount a student owes on a due date, and its collection. `ChargeKind`:
  `installment`, `isa`, `payoff`. Unique per contract and `reference` (`installment:3`,
  `isa:2026-07`, `payoff:<request>`), so a repeated run creates nothing.

  ```text
  scheduled → pending                      a collection attempt is submitted
  pending → paid                           the provider collected it
  pending → failed | overdue               the provider refused it, before or after the due date
  scheduled | failed → overdue             dunning, the day after the due date
  failed | overdue → pending               dunning's retries, or ops
  scheduled | failed | overdue → written_off        dunning, 90 days after the due date
  scheduled | failed | overdue → cancelled          no longer owed (plan paid off or ended)
  ```

  A payoff charge is never dunned: refused (`pending`), or impossible without a mandate
  (`scheduled`), it is `cancelled` and lending withdraws the payoff.

- **`CollectionAttempt`**: one request to the payment provider, key `<chargeId>.<attempt>`, the
  mandate it debits, the provider's payment id and its outcome (`pending | succeeded | failed`).
  A repeated call sends the same key and is never collected twice.
- **Billing cycle / billing run**: no aggregate of its own. `RunBillingCycleCommand` runs as of a
  day (the `billing.cycle` schedule on the 1st and the 5th at 03:00 UTC, or ops through
  `POST /ops/billing/run`): for each plan being repaid it creates a charge for each instalment
  falling due by the end of that month, and for an ISA each month of income whose declarations
  have closed (`isaPeriodClosesOn`, the 5th of the next month), assessed by lending's rules
  (ADR 017) and due that day. One plan per transaction; a charge billed late is due on the day of
  the run.
- **Collection**: submitting due charges under the mandate in force (`billing.collect`, every day
  at 06:00 UTC, and after each ops billing run). The provider answers later on
  `POST /webhooks/psp`. A charge without a mandate stays `scheduled`.
- **Dunning** (`DUNNING_STEPS`): what happens to an unpaid charge, by days from its due date, each
  step applied once and in order (`billing.dunning` every day at 07:00 UTC, or
  `POST /ops/dunning/run`): `reminder` at −3 (`ChargeDueSoon`), `first_notice` at +1
  (`ChargeOverdue`, the charge `overdue`), `retry` at +3 and +7, `second_notice` at +15,
  `arrears` at +30 (`ContractInArrears`) and `write_off` at +90 (`ChargeWrittenOff`, the contract
  defaults). A charge being collected waits for the answer. After the default no retry is
  submitted: the debt goes to recovery and the other charges only get their notices and
  write-off.
- **Arrears**: a contract with a charge past the arrears step and unpaid. A payment that leaves no
  other charge of the contract in arrears publishes `ArrearsCleared`.
- **Write-off**: the end of dunning; the charge is `written_off` with reason `dunning_exhausted`.
- **`IncomeDeclaration`**: what an ISA student earned in one month (`period` as `YYYY-MM`), one
  per contract and month. The declaration window of a month runs from its first day to the end
  of the 4th of the next (`ISA_DUE_DAY`, the 5th, closes it), so a salary paid on the 1st or 2nd
  is declared in time; a month whose window closed, or that lending has assessed, is refused
  (`period_not_open`, naming the first open month). `IncomeSource`: `self | employment_provider`.
  The amount stays in billing; `IncomeDeclared` says only that a month was declared. On the 25th,
  students who have not declared the month are reminded once (`IncomeDeclarationDue`).
- **Ledger / statement**: `billing.ledger_entries`, written from the charge events, one entry per
  event (`LedgerEntryType`: `charge`, `payment`, `write_off`, `cancellation`; positive amounts are
  owed, negative ones paid or no longer owed). `GET /contracts/:id/statement` lists them with the
  running balance.
- Events: `MandateSigned`, `MandateRevoked`, `ChargeCreated`, `ChargeDueSoon`, `ChargeSubmitted`,
  `ChargePaid`, `ChargeFailed`, `ChargeOverdue`, `ContractInArrears`, `ArrearsCleared`,
  `ChargeWrittenOff`, `ChargeCancelled`, `IncomeDeclared`, `IncomeDeclarationDue`.

## notifications

- **`EmailNotification`**: an email Tramo owes someone, written to
  `notifications.notification_log` with the event that caused it (one per event, template and
  recipient), its `reference` (the id it is about) and the template's values, then sent by a job
  on `notifications.emails`. `EmailTemplate`: `welcome`, `application_received`,
  `application_decided`, `contract_ready_to_sign`, `disbursement_settled`,
  `installment_reminder`, `installment_collected`, `payment_overdue`, `contract_in_arrears`,
  `isa_declaration_reminder`, `isa_declaration_overdue`.

  ```text
  pending → sent                           the SMTP server took it
  pending → failed                         the job's last attempt failed, or abandoned when stale
  ```

  `lastError` is a category (`smtp_550`, `timeout`, `connection_failed`), never the server's
  text. A pending email older than a day (`STALE_EMAIL_MS`) is abandoned by the hourly sweep
  rather than sent late. A sent or failed email is never sent again.

- **`WebhookSubscription`**: a center's endpoint for its events, one per center, with a secret
  generated by Tramo, shown once and stored encrypted (ADR 018). `SubscriptionStatus`:
  `active | removed`; configuring again replaces the URL and rotates the secret, and brings a
  removed subscription back. `WebhookEvent`: `application.submitted`, `application.decided`,
  `contract.signed`, `disbursement.settled`, `contract.in_arrears`, `contract.defaulted`.
- **`WebhookDelivery`**: one event told to one center, posted by a job on
  `notifications.webhooks` and signed with `X-Tramo-Signature`.

  ```text
  pending → delivered                      a 2xx answer
  pending → failed                         the round's last attempt failed, or webhook removed
  delivered | failed → pending             redelivery, as a new round
  pending (stale) → pending                redelivery of a round whose job was lost
  ```

- **Round**: the attempts of one posting, five with exponential backoff from
  `WEBHOOK_RETRY_DELAY_MS`; round 1 is the first delivery and each redelivery starts the next
  (job id `<deliveryId>.r<round>`). A pending round without an attempt for 15 minutes
  (`STALE_ROUND_MS`) is taken for lost. Each `DeliveryAttempt` keeps the status code or a failure
  category (`http_503`, `timeout`, `connection_failed`, `dns_failed`, `target_unreachable`...).
- Events: `EmailRequested`, `EmailFailed`, `WebhookSubscribed`, `WebhookUnsubscribed`,
  `WebhookDeliveryRequested`, `WebhookDelivered`, `WebhookDeliveryFailed`.

## reporting

- **Facts / read models**: one row per application, contract, disbursement and charge in
  `reporting.application_facts`, `contract_facts`, `disbursement_facts` and `charge_facts`,
  written by consumers through `ReportingProjector`. Upserts give the same facts whatever the
  order and repetition of events: the status follows the most recent event, but a final status
  is never replaced by one that is not, and the decision is set once. Reporting owns no aggregate
  and publishes no events.
- **Figures** (`portfolio-figures.ts`): pure functions over the grouped facts, computed per
  request: the center dashboard (applications by where they are, contracts by state and product,
  disbursed, collected, outstanding, written off, delinquency rate), program performance
  (approval rate, mean ticket, mean score in bands from ten scored applicants) and the ops
  overview (applications waiting for an analyst, charges failed today, transfers pending or
  failed, contracts in arrears, dead letters; `null` while the queue cannot be read).
- **Rebuild**: `POST /ops/reporting/rebuild` queues `reporting.rebuild`, one at a time. In one
  REPEATABLE READ transaction the facts are locked against writers, deleted and replayed from the
  outbox (`EventHistory`) through the same projector (ADR 019).
