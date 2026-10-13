# Bruno collection

Requests for walking the Tramo API by hand against the local stack, in
[Bruno](https://www.usebruno.com/) format (plain `.bru` files, so they diff and review like code).
The OpenAPI document at http://localhost:3000/docs remains the reference for every schema and
error.

## Setup

1. Start the stack with `docker compose up -d --build --wait`. The `seed` container loads three
   centers, six programs and the demo accounts (password `tramo demo password`):
   `admin@tramo.test` (admin), `ops@tramo.test` (ops), `admin@codeworks.test` (center admin of
   Codeworks Barcelona), `admin@berlin-code.test`, and the students `ana.garcia`, `bruno.silva`,
   `carla.moreno`, `diego.lopez` and `elena.ruiz` (all `@example.com`).
2. In Bruno, choose **Open Collection** and select this `docs/api` folder.
3. Select the `local` environment (top right). It holds the base URLs, the demo password and the
   variables the scripts fill in: tokens, ids, the first due date and so on.
4. Run the **Auth** folder first (right click, **Run**). It signs in as admin, ops and the
   Codeworks center admin, stores the center id, and registers and signs in a new student, whose
   token ends up in `studentToken`. Access tokens last 15 minutes; run Auth again when requests
   start answering 401.

Requests that need an `Idempotency-Key` send a fresh `{{$guid}}` each time. Post-response scripts
copy ids from the answers into the environment, so the requests below can be run one after another
without pasting anything.

## Happy path

Mirrors `scripts/demo.ts` (`pnpm demo` runs the same walk from a terminal):

| Step | Request                                          | Notes                                                  |
| ---- | ------------------------------------------------ | ------------------------------------------------------ |
| 1    | Catalog / List programs                          | stores the Full Stack bootcamp in `programId`          |
| 2    | Applications / Start application                 | 24 instalments, a profile that is approved             |
| 3    | Applications / Submit application                | the worker verifies and scores it                      |
| 4    | Applications / Get application                   | repeat until `status` is `approved`                    |
| 5    | Applications / Get decision                      | score, factors and reasons                             |
| 6    | Applications / Accept offer                      | lending draws up the contract                          |
| 7    | Contracts / List contracts                       | repeat until the contract appears; stores `contractId` |
| 8    | Contracts / Get contract                         | repeat until `sent_for_signature`; stores the envelope |
| 9    | Contracts / Sign contract (e-signature callback) | see below                                              |
| 10   | Contracts / Sign mandate                         | direct debit authorisation                             |
| 11   | Contracts / Get contract                         | repeat until `active` (the center has been paid)       |
| 12   | Contracts / Get schedule                         | repeat while 404; stores `firstDueDate`                |
| 13   | Billing / Run billing (ops)                      | bills the first instalment as of its due date          |
| 14   | Billing / List charges                           | repeat until instalment 1 is `paid`                    |
| 15   | Billing / Get statement                          | charge, payment and balance                            |
| 16   | Reporting / Center dashboard                     | the center's view of the same money                    |

The worker does the asynchronous steps (scoring, contract, payout, collection) within seconds;
the "repeat until" steps just mean sending the request again.

### Signing the contract

In production the e-signature provider calls `POST /webhooks/esign` with an HMAC signature. The
"Sign contract" request plays the provider: its pre-request script signs the body with the local
`ESIGN_WEBHOOK_SECRET` (`esignSecret` in the environment). It uses `require("crypto")`, so it needs
Bruno's **Developer Mode** (the JavaScript sandbox selector next to the environment).

The simpler route is a terminal, from the repository root:

```bash
pnpm esign:sign <contractId>             # or --decline
```

`scripts/esign-sign.ts` looks the envelope up as the ops user and posts the signed callback; the
contract id is in the `contractId` environment variable after step 7.

## The other folders

- **Health**: liveness, readiness and Prometheus metrics (outside `/api/v1`; metrics take the
  bearer `tramo-metrics-token`).
- **Catalog**: an admin registers a center and checks its VAT number; the Codeworks admin creates
  and publishes a program. With `VIES_MODE=test` only 100 is a valid VAT number and the seed
  already uses it, so the new center stays pending; the program requests use Codeworks.
- **Applications**: draft updates, cancellation, the ops review queue and manual decisions, and
  the risk policy.
- **Billing**: dunning, retrying a failed charge and income declarations (ISA contracts only).
- **Notifications**: the center's webhook (pointed at the compose sink; received deliveries at
  http://localhost:9099/deliveries), its delivery log and redelivery.
- **Reporting**: center dashboard, program performance, ops overview and a read model rebuild.
- **Operations**: disbursements to centers, and the center's integration API keys (issue, call
  `/me` with `X-Api-Key`, list, revoke).

Some requests are not part of the happy path and change its data: "Cancel application",
"Request payoff", "Remove webhook" and "Revise risk policy". Each one says so in its Docs tab.
