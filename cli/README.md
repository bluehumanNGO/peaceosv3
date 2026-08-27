# @peaceos/cli — `peaceos-verify`

Thin CLI over `@peaceos/core`: `keygen`, `create`, `check`.

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

## `check` — verify a `.vep` package

```
peaceos-verify check ./caso-x.vep --transparency /path/to/peaceos-transparency
```

Prints each of the six checks (integrity, field signature, org
countersignature, org identity, timestamp, package ID) on its own line, then
a verdict. Exit code is `0` for `AUTHENTIC`, `1` otherwise.

- `--transparency <dir>` — a local checkout of the public
  `peaceos-transparency` repo (or any directory with the same
  `keys/<org_id>/<key_id>.pub` layout). Without it, the org checks report
  `NOT DETERMINED` — never a false `OK` — and the verdict can never be
  `AUTHENTIC`. This is what keeps verification usable fully offline: once you
  have a local copy of the transparency directory, no network call is ever
  made by `check`.
- `--json` — machine-readable report instead of the human-readable one.

See `examples/README.md` for ready-to-run valid and tampered packages.
