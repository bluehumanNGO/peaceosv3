# AGENTS.md — PeaceOS Verify (Phase 1)

> Context file for the AI coding agent working in this repository.
> (If you use Claude Code, you may rename or symlink this to `CLAUDE.md`.)
> Written in English because code, commits and issues are in English. The
> human specification documents are the source of truth for the format.

---

## What this project is

PeaceOS Verify is open-source tooling that packages human rights evidence into
**Verifiable Evidence Packages (VEP)** and lets **any third party independently
verify** their integrity, timestamp, chain of custody and organizational
provenance — **without trusting Blue Human or any server**.

This repository covers **Phase 1 only**. Nothing else.

## Mission constraints — read first, these override convenience

These are not features; they are the reason the project exists. If any task
conflicts with one of these, the constraint wins — surface the conflict, do not
silently resolve it.

1. **Protection over features.** The tooling must NEVER expose the identity of
   field documenters or witnesses. Field identities are pseudonymous; sensitive
   fields appear only as salted commitments, never as plaintext, in a manifest.
2. **Verifiability without trust.** A third party must be able to verify a
   package **fully offline**, with no account, no upload requirement, and no
   need to trust us or any hosted service.
3. **Provenance is not truth.** We verify integrity, time and origin — never
   that the depicted event is "true". Never write copy or logic that claims
   otherwise.
4. **Open and quiet.** Fully open source. No telemetry, analytics, tracking, or
   "phone home", anywhere, ever.

## Scope — build ONLY this in Phase 1

- `spec` — the VEP format specification and its JSON Schema (source of truth).
- `core` — reference TypeScript library: hashing, signing, timestamping,
  build-package and verify-package logic.
- `cli` — thin Node CLI over `core` (`create`, `check`).
- `web` — the Verify portal: drag-and-drop a package, get a report. MUI only.
- `examples` — sample `.vep` packages and test vectors (valid AND tampered).
- `docs` — user and developer documentation.

## Out of scope — do NOT build (deferred to later phases)

- The Capture mobile app.
- The Núcleo / case management / evidence storage backend.
- Any AI/ML feature.
- Any UI component library other than Material UI.
- User accounts, auth systems, or databases beyond what local verification needs.
- A full C2PA implementation — design the manifest to be C2PA-compatible in
  spirit, but do not implement C2PA now.
- A formal transparency log (Sigstore/Rekor) — Phase 1 uses the git-based public
  directory (see below).

## Actors and how they use it (Phase 1)

- **Collecting org / field coordinator (produces evidence):** uses the **CLI**
  `create` to build and sign a package. (The friendly Capture app comes later;
  in Phase 1 packaging is done by a technical user.)
- **The organization (root of trust):** countersigns packages with its
  organizational key and maintains that key in the transparency repo.
- **Verifier / demand side (journalist, UN investigator, lawyer):** uses the
  **web portal** (no technical skill needed) or the **CLI** `check`.
- **Integrators (other tools):** import the `core` library.

## Repository layout — monorepo

Use **pnpm workspaces**. One repository for all code; the transparency directory
of organizational public keys lives in a **separate public repository**.

```
/spec        VEP format spec + JSON Schema (source of truth)
/core        TypeScript library: hashing, signing, timestamping, build + verify
/cli         Node CLI wrapping core (create, check)
/web         React + Material UI Verify portal
/examples    sample .vep packages + test vectors (valid and tampered)
/docs        user + developer docs
```

Separate public repo (do not create it here, just integrate with it):
`peaceos-transparency` — an append-only public directory of organizational
public keys. Every change is OpenTimestamped. Its git history IS the
append-only log. Verify resolves org keys against a local checkout of this repo,
so verification stays offline-capable.

## Tech stack — fixed

- **Language:** TypeScript everywhere.
- **Runtime:** Node 20+ for `core`/`cli`; modern browsers for `web`.
- **Package manager:** pnpm workspaces.
- **Crypto — use vetted libraries only, NEVER implement primitives yourself:**
  - Ed25519 signatures via libsodium (e.g. `libsodium-wrappers`).
  - SHA-256 via Node `crypto` / WebCrypto.
  - Timestamping via `javascript-opentimestamps` (RFC 3161 TSA optional).
  - Merkle trees for multi-asset sets and redaction — use a small, audited
    implementation; do not hand-roll subtle tree logic without tests.
- **Web UI — Material UI EXCLUSIVELY:**
  - React + `@mui/material` (Material UI, currently **v9**). Icons from
    `@mui/icons-material`. Styling via MUI theming and the `sx` prop.
  - Base install: `@mui/material @emotion/react @emotion/styled @mui/icons-material`.
  - Do NOT use Tailwind, Bootstrap, Chakra, custom CSS frameworks, or any other
    component kit. No ad-hoc global CSS beyond an MUI theme.
  - For correct, current component usage, consult MUI's own machine-readable
    docs: `https://mui.com/material-ui/llms.txt` and the MUI MCP server. Verify
    exact install commands on the official Installation page before scaffolding.
- **Testing:** vitest. Every crypto and verification path MUST have tests,
  including **negative tests on tampered packages** (a mutated byte, a bad
  signature, a back-dated timestamp, a missing countersignature must all FAIL).
- **License:** decision needed with maintainers. Default recommendation:
  Apache-2.0 for `spec`/`core`/`cli` to maximize adoption of the standard;
  AGPL-3.0 is the values-aligned alternative for the hosted `web` service.
  Do not pick silently — flag it.

## The VEP format

Implement exactly what `/spec` defines; treat `/spec/schema` as authoritative.
Summary of the identity model the format encodes:

- A **field pseudonymous Ed25519 key** signs the manifest (protects the person).
- The **organization countersigns** the package with its organizational key
  (the root of trust).
- The org key is resolved via the **public transparency repo**.

## Verify — checks it MUST perform (each reported separately)

1. **Integrity** — recompute SHA-256 per present asset; compare to manifest.
2. **Manifest signature** — verify the field pseudonymous signature.
3. **Organizational countersignature** — verify the org seal over the package.
4. **Identity + transparency inclusion** — resolve the org key against the
   public append-only directory and confirm inclusion; report trust level. Field
   key stays pseudonymous.
5. **Timestamp** — validate the OpenTimestamps proof over the manifest hash.
6. **Chain of custody** — verify each event's signature and ordering.
7. **Redactions** — confirm withheld fields carry a valid commitment.

Output: a clear verdict, a human-readable report, and a machine-readable JSON
result. Verification MUST complete fully offline given a local copy of the
transparency directory.

## Security & privacy — hard requirements

- No telemetry, analytics, tracking, or network "phone home". Ever.
- The web portal verifies **client-side, in the browser**. Do not require
  uploading evidence to a server to verify it.
- Never log or persist evidence content. Do not put evidence or keys in
  `localStorage` or `sessionStorage`.
- Data minimization: manifests must never contain source identities — only
  salted commitments.
- **Fail closed:** if any check cannot be completed, report failure or
  "unverified", never a pass.
- Pin dependencies; aim for deterministic, reproducible builds.
- Do not roll your own crypto. Do not weaken secure defaults for convenience.

## Coding conventions

- English identifiers, comments and commit messages. Conventional Commits.
- Keep `core` as small, pure, well-tested functions; push side effects to the
  edges (`cli`, `web`).
- No secrets in the repo. Users generate and manage their own keys.
- Ask before adding ANY new dependency — especially crypto or UI packages.

## Definition of done (Phase 1 MVP)

A third party can take a `.vep` produced by the CLI and, using the web portal or
the CLI, independently confirm integrity, timestamp, custody and organizational
provenance — offline, without trusting Blue Human. Code is open source and
documented, ships with valid and tampered example packages and passing tests,
and has been piloted once with a real organization and real evidence.

## When unsure

- Prefer the more protective and more verifiable option.
- Prefer reusing a vetted library over writing new code.
- If a requirement conflicts with the mission constraints above, the constraint
  wins — surface the conflict rather than resolving it silently.