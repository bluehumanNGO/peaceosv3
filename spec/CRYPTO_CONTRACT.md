# VEP v0.1 — cryptographic contract

> Companion to `manifest.schema.json`. The schema fixes field *shape*; this
> document fixes the exact *bytes* that get canonicalized, hashed, signed and
> timestamped. Both together are the source of truth for the VEP format.
> Locked interoperability vectors live in
> `test/fixtures/crypto-contract/expected-vectors.json` and are asserted by
> `test/crypto-contract.test.ts` — if this contract ever changes, those tests
> must fail until the vectors are regenerated deliberately.

## 1. Why this exists

`manifest.schema.json` alone tells you the manifest's shape, not what a
signature or timestamp actually covers. Two implementations that agree on the
schema but serialize or scope the signed payload differently will produce
packages that look valid but don't cross-verify. This document removes that
ambiguity.

## 2. Canonicalization

All canonicalization uses **JCS, RFC 8785** (`canonicalize` npm package,
draft-approved for this project). JCS gives a unique, deterministic byte
string for any JSON value: object keys sorted, no insignificant whitespace,
fixed number formatting. Two implementations that both run JCS over the same
logical object produce byte-identical output — which is the property
signatures and hashes need.

Everywhere below, `JCS(x)` means: take the JavaScript/JSON value `x`, run it
through RFC 8785 canonicalization, and treat the result as a UTF-8 string.

## 3. The envelope split: `content` vs. envelope fields

The manifest has three fields that are computed **after** everything else is
fixed, because each of them either identifies, signs, or countersigns the
rest of the document: `package_id`, `signature`, `org`.

```
manifest = content ∪ { package_id, signature, org }

content  = manifest \ { package_id, signature, org }
```

**Deviation from the literal task wording, flagged explicitly:** the original
instruction defined `content` as "the manifest without `signature` and
`org`" and separately recommended deriving `package_id` from `content_hash`.
Those two statements are only compatible if `package_id` is *also* excluded
from `content` — otherwise `content_hash` would depend on a value
(`package_id`) that itself depends on `content_hash`, which is exactly the
circularity the task prohibits ("nada firma un documento que se contenga a sí
mismo"). This contract excludes `package_id` from `content` for that reason.
This is the same pattern used by content-addressed identifiers elsewhere
(git commit hashes, IPFS CIDs): the ID is computed over everything *except*
the ID.

`content` still includes `vep_version`, `created_at`, `assets`, `custody`,
`redactions`, and `timestamps`. Asset bytes and `.ots` proof bytes are never
part of `content` — only their hashes/refs are, exactly as the schema already
expressed (`assets[].sha256`, `timestamps[].proof_ref`).

## 4. The signing chain

```
content_hash    = SHA-256( JCS(content) )                          32 raw bytes; hex-encoded, lowercase, only for manifest/display purposes
package_id      = "sha256:" + hex(content_hash)
signature       = Ed25519_sign(field_private_key, content_hash)
signed_content  = content ∪ { signature }        (= manifest \ { package_id, org })
org.countersig  = Ed25519_sign(org_private_key, JCS(signed_content))
timestamp proof = OpenTimestamps proof over content_hash
```

**`content_hash` as bytes always means the raw 32-byte SHA-256 digest, never
its hex text form.** Hex is only how `content_hash` gets written into
`package_id` for humans to read; every place that actually consumes
`content_hash` as a cryptographic input — the field signature and the
timestamp proof — consumes the 32 raw bytes. An earlier revision of this
document said the timestamp proof targets "the hex string's UTF-8 bytes"
(64 bytes) while §4.1 (below) already described the field signature's
payload as "32 bytes" — an internal contradiction, caught while implementing
`core` in M1: `opentimestamps`'s `OpSHA256` operation requires an exact
32-byte message (`_DIGEST_LENGTH() === 32`); feeding it a 64-byte hex string
throws. Raw bytes are also the standard, size-minimal choice for signing a
digest. Fixed here to one convention, used everywhere.

Nothing in this chain signs or hashes a structure that contains itself:

- `content_hash` depends only on `content` (never on `package_id`,
  `signature`, or `org`).
- `signature` depends only on `content_hash`.
- `org.countersig` depends on `content` and `signature`, never on `org`
  itself or on `package_id`.
- `package_id` depends only on `content_hash`, and is not an input to
  anything.

### 4.1 Why the field signature signs a hash, but the org signature signs canonical bytes directly

The field signature signs `content_hash` (32 bytes) rather than
`JCS(content)` directly: a fixed-size payload is what gets anchored by the
timestamp proof, and keeps the field key's signing operation independent of
package size (large evidence manifests still produce a 32-byte signing
input). The org countersignature instead signs `JCS(signed_content)`
directly: by the time the org counter-signs, the verifier already needs the
full canonical bytes of `signed_content` to validate both the field signature
math and the org signature, so there is no benefit to introducing a second
hash step — Ed25519 already hashes its input internally (SHA-512) regardless
of whether the caller pre-hashes. Both are valid Ed25519 usage patterns; the
asymmetry is a size/consistency tradeoff, not a security one. Flagging this
so the choice is visible rather than silently baked in.

### 4.2 Timestamp target

`timestamps[].target` is fixed to the literal value `"content_hash"` (schema
enum). The original example manifest in the spec used `"manifest_sha256"`,
which is ambiguous — SHA-256 of the raw JSON bytes as stored (which vary with
whitespace/key order) or of some canonical form? `content_hash` names the
exact, unambiguous quantity defined above (raw 32 bytes, per the note above)
and is the only accepted value.

## 5. Field public key in the package

The field signature's public key now travels **inside the package**, not
only as a `key_id` label, so Verify can check the signature fully offline
without a lookup:

- `keys/<key_id>.pub` — the raw 32-byte Ed25519 public key, stored as raw
  bytes (no base64/hex text wrapper). Referenced by `signature.public_key_ref`
  (e.g. `"keys/field-01.pub"`).
- `signature.public_key_sha256` — SHA-256 of those raw 32 bytes, hex-encoded.
  This field lives inside `signature`, which is part of `signed_content`,
  which the org countersignature covers. That is how "the organization
  attests the field key" is enforced structurally: an attacker who swaps
  `keys/field-01.pub` for a different key, without also forging a new org
  countersignature, gets caught the moment Verify recomputes the key file's
  SHA-256 and compares it to the org-covered `public_key_sha256`. The
  `.pub` file itself is not embedded in `content` or signed directly — it
  doesn't need to be, since its hash already is.
- All raw cryptographic artifacts in the package (`*.sig`, `*.pub`, `*.ots`)
  are raw binary files, not base64/hex/PEM-wrapped text. This wasn't pinned
  down before and is needed for interoperability: hashing "the public key
  file" is ambiguous if implementations might encode it differently.

Verify's key-resolution order for the field signature: read
`signature.public_key_ref` → read that file's raw bytes → confirm
`SHA-256(bytes) == signature.public_key_sha256` → use those bytes as the
Ed25519 public key to check `signature` against `content_hash`. The field
key stays pseudonymous throughout — nothing here ties it to a real-world
identity, only to the organization's countersignature.

## 6. Redaction commitments — injective by construction

```
commitment = SHA-256( JCS({ "salt": <base64>, "field": <field_name>, "value": <value> }) )     hex-encoded
```

stored in the manifest as:

```
"commitment": "<hex>"
```

i.e. `redaction.commitment` is a bare `sha256Hex` value — no label wrapper.
The construction (what got hashed, and how) lives only here, not in the
manifest.

This supersedes an earlier draft of this contract that defined the
commitment as raw byte concatenation, `SHA-256(salt || UTF-8(field_name) ||
UTF-8(value))`, and flagged (§6, previous revision) that the concatenation
had no separator between `field_name` and `value`, so two different
`(field_name, value)` pairs could in principle hash to the same input at the
boundary. Hashing a **JCS-canonicalized JSON object** instead of raw
concatenated bytes removes that ambiguity without hand-rolled length
prefixing: JCS represents `field` and `value` as distinct, quote-delimited
JSON strings (with internal quotes/backslashes escaped per RFC 8785), so the
serialized form is injective in `(salt, field, value)` — there is no byte
sequence that two different triples can both produce. This reuses the same
canonicalization machinery already required for `content` (§2) instead of
inventing a second, bespoke framing rule.

- **`salt`** is 32 random bytes (CSPRNG), base64-encoded for embedding as a
  JSON string value in the hashed object. **`salt` is never written to the
  package.** It is generated and custodied by the organization alone, and
  revealed only if and when the field is disclosed (e.g. to a court), at
  which point anyone can recompute the commitment from
  `(salt, field, value)` and check it against what's in the manifest —
  proving the disclosed value matches what was committed at packaging time,
  without the package ever having contained the plaintext.
- **`field`** is the same string as the sibling `field` property in the same
  `redactions[]` entry (e.g. `"witness_identity"`) — not secret, already
  visible in cleartext next to the commitment. Including it in the hashed
  object is still domain separation, exactly as before: it stops a
  commitment computed for one field from being replayed as valid for a
  different field.
- v0.1 scopes commitments to **UTF-8 string values only**. Structured
  (object/array) redacted values are out of scope for v0.1 — deferred rather
  than speculatively generalized now; a future version can define a
  canonical encoding for them if a real use case needs it.

## 7. Minor decisions (as requested, not blocking)

- **`package_id`: derived from `content_hash`, not a random UUID.** Chosen
  over a random label because it makes the identifier self-verifying — given
  only the manifest, anyone can confirm `package_id` wasn't tampered with by
  recomputing `content_hash`, without needing any signature — consistent with
  the project's broader "verify it yourself" ethos, rather than an arbitrary
  opaque label. (Verify still MUST
  perform this recomputation as an integrity check in M1 — the schema can
  only pin the string shape `sha256:<64 hex>`, not the equality, since that
  requires computing JCS/SHA-256, which is out of JSON Schema's reach.)
- **Algorithm agility: kept `sha256` as a fixed field name, not an
  `{ "alg": "...", "value": "..." }` wrapper.** v0.1 already fixes SHA-256
  and Ed25519 as the only supported primitives per `AGENTS.md`'s tech stack;
  an agility wrapper would be speculative generality with no second
  algorithm to actually support. If a second digest algorithm is ever
  adopted, that's a `vep_version` bump, which can introduce the wrapper form
  then. More generally: **the entire cryptographic suite (JCS, SHA-256,
  Ed25519, OpenTimestamps, and every construction in this document) is
  bound to `vep_version`, not negotiated per field or per package.** A
  verifier reads `vep_version` once and from it knows unambiguously which
  fixed suite applies to the whole package. Agility, if ever needed, is a
  new `vep_version` value with its own dated section in this document —
  never a per-field `alg` switch that could make different parts of the same
  package use different primitives.

## 8. What this contract does not cover

- Chain-of-custody event signature payloads (`custody[].sig_ref`) — deferred
  to M2, per the spec's own milestone plan (`docs/spec-source.md`, §8).
- Merkle-based multi-asset/redaction proofs — explicitly not needed for v0.1;
  per-field salted commitments (§6) and the already-signed per-asset
  `sha256` cover v0.1's redaction and integrity needs without a Merkle tree.
- Actual implementation of hashing/signing/timestamping functions — that is
  `core`'s job (M1), per `AGENTS.md`'s repository layout. This document is
  the contract `core` must implement against; it contains no executable
  library code itself, only the test-only vectors under
  `test/fixtures/crypto-contract/`.
