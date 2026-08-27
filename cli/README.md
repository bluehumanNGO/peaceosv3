# @peaceos/cli — `peaceos-verify`

Thin CLI over `@peaceos/core`: `keygen`, `create`, `check`, `reveal`.

## Build

```
pnpm --filter @peaceos/core run build
pnpm --filter @peaceos/cli run build
node cli/dist/bin.js <command> ...
```

## `keygen` — generate an Ed25519 keypair

```
peaceos-verify keygen --out field-01
# writes field-01.pub (32 raw bytes) and field-01.key (64 raw bytes — keep secret)
```

You need one keypair for the field (pseudonymous) identity and one for the
organization (root of trust).

## `create` — build a `.vep` package

```
peaceos-verify create \
  --asset ./evidence/testimonio_01.mp4 \
  --asset ./evidence/photo.jpg:image/jpeg \
  --field-key ./field-01 --field-key-id field-01 \
  --org-key ./org-2026 --org-id org-recolectora --org-key-id org-2026 \
  --transparency-ref "git:keys@<commit-hash-in-the-peaceos-transparency-repo>" \
  --out ./caso-x.vep
```

- `--asset <path>[:<media-type>]` — repeatable. Media type is inferred from
  the file extension for common formats (mp4, mov, jpg, png, pdf, txt, wav,
  mp3); anything else needs the explicit `:<media-type>` suffix, or falls
  back to `application/octet-stream`.
- `--field-key` / `--org-key` are prefixes: `<prefix>.pub` and
  `<prefix>.key`, as written by `keygen`.
- `--timestamp network|local-pending` (default `network`) — `network`
  submits `content_hash` to public OpenTimestamps calendars over the
  internet (the real feature, not telemetry — see `spec/CRYPTO_CONTRACT.md`
  and `AGENTS.md`'s "fully offline" constraint, which governs `check`, not
  `create`). `local-pending` builds a structurally real but never-submitted
  proof, entirely offline — useful for testing.

The organization's own public key is **not** written into the package: it's
resolved at `check` time from a local checkout of the separate
`peaceos-transparency` repo, keyed by `org_id`/`key_id`.

`create` does not (yet) expose flags for authoring a custody chain or
redactions — `@peaceos/core`'s `build()` fully supports both (`custody` and
`redactions` inputs; see `core/src/types.ts`), and `examples/src/generate.ts`
shows a complete example, but designing a CLI authoring UX for a multi-actor
custody chain deserves its own pass rather than being rushed into this one.
Packages with custody/redactions built via `core` directly verify fully
through `check` and `reveal` below.

## `check` — verify a `.vep` package

```
peaceos-verify check ./caso-x.vep --transparency /path/to/peaceos-transparency
```

Prints each of the eight checks (integrity, field signature, org
countersignature, org identity, timestamp, package ID, custody, redactions)
on its own line, then a verdict. Exit code is `0` for `AUTHENTIC`, `1`
otherwise.

- **Custody** — if the manifest has a `custody[]` chain, verifies every
  event's own Ed25519 signature (see `spec/CRYPTO_CONTRACT.md` §9), that the
  chain starts with a `"captured"` event, and that events are chronologically
  non-decreasing. Each event's actor key is resolved the same way the field
  signature's key is (`actor_public_key_ref` + `actor_public_key_sha256` —
  an unattested/swapped actor key is rejected before any signature math, not
  after). No custody events present is reported `OK` (nothing to check),
  not a defect — this keeps M1-era packages verifying unchanged.
- **Redactions** — confirms every `redactions[]` entry's commitment is a
  well-formed digest, and reports every asset marked `withheld: true` as
  "withheld but committed" (its `sha256` is still signed, just not shipped).
  This check cannot confirm a specific commitment matches a real value
  without the salt — that's what `reveal` (below) is for. No redactions and
  no withheld assets present is reported `OK`.

- `--transparency <dir>` — a local checkout of the public
  `peaceos-transparency` repo (or any directory with the same
  `keys/<org_id>/<key_id>.pub` layout). Without it, the org checks report
  `NOT DETERMINED` — never a false `OK` — and the verdict can never be
  `AUTHENTIC`. This is what keeps verification usable fully offline: once you
  have a local copy of the transparency directory, no network call is ever
  made by `check` **unless you explicitly pass `--check-bitcoin`** (below).
- `--json` — machine-readable report instead of the human-readable one.

### Timestamp: `bound (offline)` vs. `anchored (chain-confirmed)`

By default — **and this is the default that matters, offline, no flags
needed** — `check` reports:

```
Timestamp: bound (offline) — Proof is well-formed and binds exactly this
package's content_hash (offline check). Timestamp not chain-confirmed;
run with --check-bitcoin <esplora-url> to confirm.
...
Verdict: AUTHENTIC
Note: timestamp not chain-confirmed; run with --check-bitcoin <esplora-url> to confirm.
```

This is a real, meaningful, fully offline check: it proves the `.ots` proof
in the package genuinely targets *this* package's `content_hash` (catching a
proof reused or swapped from a different package) and is structurally
well-formed. It does **not** prove the underlying Bitcoin attestation is
real — that needs an actual query against the chain, which `check` never
does unless you ask it to.

```
peaceos-verify check ./caso-x.vep --transparency ./peaceos-transparency \
  --check-bitcoin https://your-own-node-or-explorer.example/api
```

- `--check-bitcoin <esplora-url>` is **opt-in only**. Omit it and `check`'s
  behavior is byte-for-byte identical to not having the flag at all — zero
  network requests, the sacred default. Pass it and `check` queries **only**
  the endpoint you gave it (an Esplora-compatible REST API — e.g. your own
  `esplora`/`electrs`/`mempool.space` instance run against your own Bitcoin
  node, or any explorer you trust) to fetch the block your package's proof
  claims to be anchored in, and confirms the merkle root matches.
- On success: `Timestamp: anchored (chain-confirmed) — ...`.
- If the attestation isn't confirmable yet (still pending in the calendar,
  not yet mined into a block) or your endpoint can't be reached: `Timestamp:
  NOT DETERMINED (chain confirmation attempted) — ...`. This is never
  reported as a package defect (`FAIL`) — an unreachable or slow endpoint
  says nothing about whether the package itself is genuine — and never
  silently treated as `OK` either. Because the verdict requires every check
  to be `OK`, an unresolved `--check-bitcoin` attempt is enough to keep the
  verdict at `PROBLEMS DETECTED`, even though the offline `bound` check
  passed: if you explicitly asked for the stronger guarantee, `check` won't
  quietly hand you the weaker one instead.

**Metadata warning:** the flag contacts the endpoint you point it at, and
that operator can see your IP and the block height you're asking about at
instant T; a block height alone doesn't reveal which package is being
verified, but it's information that, in the default mode, never leaves your
machine at all. For maximum privacy, point it at your own node.

## `reveal` — disclose a redacted field

```
peaceos-verify reveal ./caso-x.vep \
  --field witness_identity \
  --salt "<base64 salt the organization custodied outside the package>" \
  --value "<the plaintext value being disclosed>"
```

Given the exact salt and value the organization kept outside the package
(never in it — see `spec/CRYPTO_CONTRACT.md` §6), recomputes
`SHA-256(JCS({salt, field, value}))` and confirms it matches the commitment
recorded for `field` in the manifest. This is how a redacted field gets
disclosed — to a court, an investigator, whoever the organization decides —
in a way anyone can independently confirm corresponds to what was committed
at packaging time, without the package itself ever having carried the
plaintext.

- Exit code `0` and `Matches committed value: YES` on a match; exit code `1`
  and `Matches committed value: NO` otherwise. There is no partial match and
  no "try without a salt" mode — every call needs a real, caller-supplied
  salt and value, or it reports no match.
- `--field` must name a `redactions[]` entry in the manifest; if it doesn't
  exist, `reveal` reports no match with a message saying so — it never
  guesses or falls back to a different field.
- `--json` — machine-readable `{ field, matched, message }` instead of the
  human-readable lines.

See `examples/README.md` for ready-to-run valid and tampered packages,
including a working `reveal` example.
