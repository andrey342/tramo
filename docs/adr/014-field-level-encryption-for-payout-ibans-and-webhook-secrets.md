# 014. Field-level encryption for payout IBANs and webhook secrets

- Status: accepted
- Date: 2026-10-10

## Context and problem statement

Training centers give Tramo the IBAN that disbursements are paid into, and later a secret to sign
the webhooks sent to them. Whoever changes an IBAN redirects money; whoever reads a webhook secret
can forge events to the center. Both sit in Postgres next to data that support staff, the
read-only diagnostics role (`tramo_ro`), backups and database dumps can all read. Hashing does not
help: the IBAN is needed in full for a payout, the secret in full to compute an HMAC. How are these
values kept unreadable outside the code paths that need them?

## Decision drivers

- A database dump, a backup or the diagnostics role must not reveal them.
- Listings and logs need something recognisable (the last digits), not the value.
- Keys must be rotatable, and losing the database alone must not lose the data.
- No new infrastructure for a local demo; a managed KMS must remain a drop-in later.

## Considered options

1. Rely on disk and backup encryption of the database provider.
2. `pgcrypto` in SQL, with the key passed in queries.
3. Application-side AES-256-GCM per column, key from configuration, versioned ciphertext.

## Decision outcome

Option 3. `FieldCipher` (`src/shared/infrastructure/crypto`) encrypts single values with
AES-256-GCM and a random 96-bit IV, stored as `v1.<iv>.<tag>.<ciphertext>`. Repositories encrypt
on save and decrypt on load, so the domain keeps working with `Iban`. Next to each encrypted column
the table keeps what listings may show (the last four characters of an IBAN). The key comes from
`FIELD_ENCRYPTION_KEY`; a production process refuses the development key published in the repo.

Option 1 protects stolen disks, not a stolen dump or an over-privileged role. Option 2 sends the key
to the database with every query, where it can end up in logs and `pg_stat_statements`.

### Consequences

- Good: dumps, backups and `tramo_ro` see ciphertext; GCM also rejects a value modified in the
  database instead of paying into it.
- Good: the version prefix allows rotation: add a `v2` key, decrypt with either, re-encrypt in a
  background job, then retire `v1`.
- Bad: encrypted columns cannot be searched or indexed by value. Nothing needs to find a center by
  its IBAN; if something does, store a keyed hash (HMAC) of the value next to it.
- Bad: the key is now the secret that matters. It lives in the environment like the JWT secret;
  in production it belongs in a secrets manager, and moving to a KMS means replacing `FieldCipher`'s
  key source, not the format.
