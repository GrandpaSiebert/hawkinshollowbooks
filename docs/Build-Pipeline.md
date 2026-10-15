# Hawkins Hollow Build Pipeline

This document explains the build and ingestion flow.

## Primary Build Command

Run from repository root:

node scripts/generate-site.js

This command refreshes generated artifacts and rebuilds site output.

## Scanner and Importers

- scripts/scan-library.js
- scripts/library-scanner.js
- scripts/amazon-kdp-import.js
- scripts/character-canon-import.js
- scripts/world-canon-import.js
- scripts/relationship-canon-import.js
- scripts/environment-canon-import.js
- scripts/landmark-canon-import.js

## Generation Sequence (High Level)

1. Scan canonical Library content.
2. Import KDP publication status from the root `Amazon KDP Info.xlsx` and
   generate canon projections from the current Library scan.
3. Merge book data.
4. Build typed entity index.
5. Build provenance-aware entity graph.
6. Build typed search index.
7. Render static pages and universal entity pages.

## Authority and QC Contract

- The Library supplies manuscripts, book identity/files, character canon
  documents, relationships, environments, and landmarks. Each build scans the
  current Library; a missing or empty Library is a build error.
- The Book Model supplies curated book presentation fields. It does not
  override Library identity or manuscript content.
- The unchanged root `Amazon KDP Info.xlsx` supplies KDP Live status. KDP
  eligibility is resolved by the shared `canonical-book-routes` helpers.
- Character directory metadata remains in `data/characters.json`; character
  canon excerpts and associations are generated from current Library documents.
- World Canon JSON files and `generated/world-canon-index.json` are derived
  build artifacts. They are refreshed from the Library scan and are not
  fallback sources when the Library is unavailable. Legacy relationship,
  environment, landmark, and World Canon snapshot JSON files are not substituted
  for current Library-derived records.
- The generator and canonical validator read the same
  `data/canonical-authority-registry.json` and resolve records through its
  canonical source contract. QC performs additional checks but does not select
  compatibility records or regenerate a second authority registry.
- `build-recovery/` is the single deployable output. The deployment workflow
  validates and uploads that generated artifact without modifying it after
  validation.

## Verification Signals

A successful build should report updated counts for:

- indexed books
- search records
- entity index entities
- entity graph nodes/edges

## Sitemap Last-Modified Tracking

Every eligible sitemap URL receives a `YYYY-MM-DD` `<lastmod>` from
`data/sitemap-lastmod-baseline.json` and the most recent successful Pages
deployment state. The checked-in seed records the 2026-10-05 Stage 4D tracking
baseline from the successful deployment snapshot in run `37312228527`
(`50765cea0faacea8d62215e2d629974299262ef9`). Its date means that this exact
public representation was first entered into the authoritative Stage 4D
ledger; it does not assert that pre-existing content changed that day.

The build fingerprints public HTML through the existing Stage 4C snapshot
logic, then applies lastmod dates to sitemap XML. Sitemap metadata is excluded
from page fingerprints. CI restores the last successful deployment state
before building and supplies that run's UTC date. Unchanged fingerprints keep
their dates; changed or newly eligible pages receive the supplied candidate
date. The updated ledger is retained inside the existing deployment-state
artifact only after Pages succeeds. A failed deployment therefore cannot
advance the authoritative dates, and no commit/deploy loop is created.

Missing or corrupt baseline/state, mismatched snapshot provenance, or a
changed/new fingerprint without a supplied deployment date fails closed.
Removed or ineligible URLs are omitted from the current sitemap and ledger.
Local builds that include a changed/new public page must explicitly set
`HH_SITEMAP_DEPLOYMENT_DATE`; there is no implicit clock fallback.
Filesystem timestamps and source-document modification dates are not used.

## Output Directory Note

The current generator writes static output to the recovery build directory instead of the main build folder:

- build-recovery/

This is an implementation detail of the current build pipeline and is useful when verifying generated pages locally. The visitor-facing VIP log should continue to describe only the experience change, not the build output path.

## Local Preview

node scripts/preview-site.js

Then open http://localhost:8080/

## Private Release Snapshot Candidate (Local Only)

Snapshot preparation is an explicit, two-step local process. It does not upload,
publish, stage, commit, or deploy. The original `Library`, KDP workbook, and
tracked identity registries are read-only inputs. Never point the destination
at the repository, `Library`, or a OneDrive archive.

### Owner-reviewed Stage 8L inventory baseline

The owner approved this inventory baseline for **review purposes only**:

- Source-set SHA-256: `95bc6f675d686b36ebb8909754ef86998244256ecf95949dd7de80d7e24a442e`
- KDP workbook SHA-256: `7513f531d5f15904660ea9d7a1cf762e5c47eb176b8de58a2724785a60c7f985`
- Composition: 1,448 Library payloads plus one KDP workbook (1,449 payload
  records total).
- Library composition: 80 book Story Masters, 1,000 freebie manuscripts,
  250 selected illustrations, and 118 character/world-canon DOCX files.
- HH-F-0008 and HH-F-0009 are ordinary authoritative Story Master inputs, not
  no-Story-Master exceptions.

This approval identifies the reviewed inventory hashes only. It does **not**
authorize creating an approval record or signature, preparing or finalizing a
snapshot candidate, uploading any files, changing R2, or publishing/deploying
a website. Each of those actions requires separate explicit authorization.
Any source change requires a new inventory and owner review of its new hashes.

First produce a source inventory at a private location outside the repository
and protected source directories:

```powershell
node scripts/prepare-release-snapshot.js --inventory-only `
  --repository-root "C:\path\to\hawkins-hollow-site" `
  --library-root "C:\path\to\hawkins-hollow-site\Library" `
  --workbook "C:\path\to\hawkins-hollow-site\Amazon KDP Info.xlsx" `
  --archive-root "C:\path\to\OneDrive archive" `
  --inventory-output "D:\private-review\release-inventory.json"
```

Review the inventory's full source set, canonical IDs, scanner metadata,
`sourceSetSha256`, and `workbookSha256` with the owner. The tool does not treat
an inventory as approval. The Stage 8L baseline approval does not authorize
creating or signing a preparation approval.

Preparation authorization uses a canonical JSON record with exactly these
fields:

```json
{
  "schemaVersion": 1,
  "purpose": "prepare-release-snapshot",
  "sourceSetSha256": "the-reviewed-source-set-sha256",
  "workbookSha256": "the-reviewed-workbook-sha256",
  "keyId": "sha256-of-trusted-ed25519-public-key",
  "issuedAt": "2026-10-11T15:00:00.000Z",
  "expiresAt": "2026-10-11T16:00:00.000Z"
}
```

The detached signature is a separate file containing the base64 encoding of
the 64-byte Ed25519 signature over the UTF-8 canonical JSON (object keys sorted,
two-space indentation, one trailing newline). The trusted public key must come
from the separately supplied trusted-key configuration, never from the approval
record. Approval JSON and trusted-key JSON reject duplicate member names and
unknown approval fields. Timestamps must be canonical UTC values with
millisecond precision; `issuedAt` cannot be in the future and `expiresAt` must
be later than the current time and issuance time.

The trusted-key configuration has schema version `1` and a `keys` array; each
entry has exactly `keyId`, `algorithm` (`Ed25519`), `publicKeyPem`,
`purposes` (which must include `prepare-release-snapshot`), and `status`
(`active`). The key ID is SHA-256 of the DER-encoded SPKI public key. The
preparation command also requires `--trusted-key-fingerprint`, an independently
established 64-character lowercase SHA-256 fingerprint. Verification requires
the signed record's key ID, configured key ID, derived public-key fingerprint,
and this independent pin to agree. A trust file alone cannot enroll a key.
The pin must come from an owner-controlled source independent of the trust
file (for example, a protected operator configuration); passing a fingerprint
that was copied from an untrusted trust file defeats the pin's purpose.

This check authorizes candidate preparation only; it does not authorize upload,
R2 changes, deployment, or publication. No production signing key, signed
approval, or trusted-key configuration is provisioned. Before any real
approval, the owner must decide the signer identity and approval process,
independent trust bootstrap/review and storage of the fingerprint pin, offline
private-key custody, key rotation, expiry/renewal, revocation, and recovery.
Approvals are reusable during their validity window, but only for the exact
signed source-set and workbook hashes. No one-time replay ledger is maintained.
Expiration checks use the local system clock; an owner-controlled, correctly
synchronized clock is required for the stated validity window to be meaningful.
The current local verifier fails closed when any authorization component is
missing, malformed, untrusted, stale, or invalid. Synthetic tests use
disposable keys and do not establish production trust.

Path and source integrity checks reject traversal and observed symlinks and
detect source changes during inventory/copy. They do not defend against a
concurrent malicious process able to replace entries in trusted local
directories between filesystem checks and use. Such concurrent local
modification is outside the current threat model; run only in owner-controlled,
non-writable source and destination-parent directories.

Snapshot preparation, if separately authorized, requires matching approval
and a new, absent destination outside all protected paths:

```powershell
node scripts/prepare-release-snapshot.js `
  --repository-root "C:\path\to\hawkins-hollow-site" `
  --library-root "C:\path\to\hawkins-hollow-site\Library" `
  --workbook "C:\path\to\hawkins-hollow-site\Amazon KDP Info.xlsx" `
  --archive-root "C:\path\to\OneDrive archive" `
  --approval-file "D:\private-review\signed-approval.json" `
  --signature-file "D:\private-review\signed-approval.sig" `
  --trusted-keys "D:\owner-trust\trusted-approval-keys.json" `
  --trusted-key-fingerprint "sha256-fingerprint-established-out-of-band" `
  --destination "D:\private-snapshots\candidate-001"
```

Preparation rejects stale approval, unsafe or ambiguous source mappings,
symlinks, source changes, and an existing destination. It writes into a fresh
temporary sibling directory, verifies every copied file and the complete
candidate, then renames the temporary directory into place. A process
interruption may leave a uniquely named `.partial-*` directory; inspect and
remove only that specific incomplete directory before retrying. Existing
candidates are never overwritten or cleaned up automatically.

Verify an existing candidate without access to its source documents:

```powershell
node scripts/verify-release-snapshot.js `
  --repository-root "C:\path\to\hawkins-hollow-site" `
  --library-root "C:\path\to\hawkins-hollow-site\Library" `
  --archive-root "C:\path\to\OneDrive archive" `
  --candidate "D:\private-snapshots\candidate-001"
```

The verifier also checks the candidate's recorded tracked identity-input hashes
against `data/characters.json` and `data/entity-id-registry.json` in the selected
repository root.

The manifest contains exact source paths, canonical identities, per-file sizes
and SHA-256 hashes, scanner path metadata, and tracked identity-input hashes.
HH-F-0008 and HH-F-0009 are ordinary Story Master payloads; no no-Story-Master
exceptions are currently approved. Candidate contents include book Story
Masters, selected freebie manuscripts and illustrations, required
character/world-canon DOCX inputs, and the reviewed KDP workbook. The inventory
and candidate are private; do not put them in the public repository, Pages
output, Actions artifacts, or logs. These local commands have no
remote-storage or deployment capability.

An existing Story Master for a future no-Story-Master exception is recorded in
inventory as an unresolved discrepancy, not included in the candidate.
Candidate preparation stops while any such discrepancy exists. Exception
changes require explicit source-authority review before inventory is rerun.

### Stage 8N — Offline approval-signature verifier

The local preparation command now requires all three authorization inputs:
`--approval-file`, `--signature-file`, and `--trusted-keys`. It verifies the
canonical Ed25519-signed preparation-purpose record against a separately
configured active trusted key and the freshly calculated source-set and
workbook hashes. Inventory-only remains non-authorizing. Focused tests exercise
synthetic keys, tampering, mismatched hashes, wrong purpose, unsupported schema,
and missing or untrusted authorization.

This local verifier does not provision production trust or authorize use of the
Stage 8L baseline. Before creating a real signed approval or candidate, obtain
owner decisions on signer identity, trust bootstrap and review, offline
private-key custody, rotation, expiry, revocation, and recovery. Real candidate
preparation still requires separate explicit owner authorization. Upload, R2
configuration, CI retrieval, and website deployment remain separate future
stages and require separate authorization.

### Stage 8Q — Proposed owner signing-key enrollment and recovery

**Planning only. This procedure does not enroll a key or authorize signing,
approval creation, or candidate preparation.** No production key, trust file,
fingerprint, or approval is currently provisioned. Implementing a real signing
workflow and executing each owner-controlled step below require fresh,
separate authorization.

#### Offline key generation and custody

1. Designate the owner as the sole signing authority and use a dedicated,
   owner-controlled Windows computer that is offline during key generation and
   signing. Keep it separate from the preparation workstation and repository.
   Update and malware-scan it before disconnecting it; do not reconnect it to
   transfer key material.
2. Generate an Ed25519 key pair with a vetted, locally installed cryptographic
   tool on an encrypted BitLocker volume. Protect the private key with a strong,
   unique passphrase and restrictive NTFS ACLs for the owner account. Do not
   put the private key, passphrase, or recovery material in command history,
   environment variables, clipboard history, screenshots, cloud sync, email,
   source control, or a shared folder. Do not use the site's Node test fixtures
   or synthetic test keys as production keys.
3. Keep the primary private-key file offline. Make two encrypted backups on
   separate removable media, verify that each can be read, and store them
   separately in locked locations under owner control. Record the key ID and
   custody locations without recording the private key or passphrase. If the
   owner cannot maintain this custody, do not enroll signing authority.

#### Independent fingerprint establishment and trust enrollment

1. Export only the public key from the offline signer. Compute the key ID as
   SHA-256 over the DER-encoded SubjectPublicKeyInfo bytes, matching
   `getApprovalPublicKeyId`.
2. Verify that fingerprint independently on a second owner-controlled device
   using a separate cryptographic tool or installation. Compare the complete
   fingerprint through a second authenticated channel (for example, read it
   directly from the offline display and compare it with the independently
   computed value). Do not take the pin from the preparation workstation's
   trust file or from the same unverified transfer used to deliver the public
   key.
3. Only after this comparison, create a trust-store entry for the public key
   with `algorithm: "Ed25519"`, `purposes: ["prepare-release-snapshot"]`, and
   `status: "active"`. Independently record the verified fingerprint in the
   owner-controlled configuration used to supply
   `--trusted-key-fingerprint`. Protect both the trust store and pin from
   unreviewed changes; review their fingerprints before each use. A trust
   store and pin stored together in an unprotected directory do not provide
   independent trust.
4. Test enrollment and mismatch rejection only with synthetic fixtures first.
   Never substitute a synthetic key for the enrolled public key in production
   trust configuration.

#### Purpose-limited approval signing and review

1. Produce a fresh inventory using the documented inventory-only command.
   Review the full source set and workbook hash; inventory review alone does
   not authorize preparation.
2. After separate owner authorization to approve that exact inventory, create
   an approval record containing exactly the supported fields:
   `schemaVersion`, `purpose`, `sourceSetSha256`, `workbookSha256`, `keyId`,
   `issuedAt`, and `expiresAt`. Use purpose
   `prepare-release-snapshot`, the reviewed hashes, the enrolled key ID, and
   canonical UTC timestamps. Choose a short validity period; check expiry and
   issuance against a trusted, synchronized clock.
3. Transfer the record (not private Library content) to the offline signing
   computer using controlled removable media. Independently review the purpose,
   both hashes, key ID, issuance, and expiry on the offline computer. Sign the
   canonical UTF-8 JSON bytes exactly as specified above. Return only the
   signed record and detached signature. Verify the signature and enrollment
   pin on the preparation machine before any separately authorized candidate
   preparation.
4. Approvals can be reused during their validity window, but only with the
   exact signed source-set and workbook hashes. This design has no one-time
   nonce or replay ledger. Do not treat a valid signature as authorization to
   upload, publish, deploy, or change infrastructure.

The current repository has verification support but no approved production
signing command or production signing key. A real signing workflow/tool must
be separately designed and authorized; never improvise a production signer
with ad hoc commands that may alter canonical bytes or expose key material.

#### Backup, loss, rotation, and retirement

- Test backup readability on the offline signing computer without exporting
  the private key to the preparation workstation. Keep backup media encrypted,
  access-controlled, and geographically separate.
- If the private key is lost, do not attempt to reconstruct it from the
  public key. Mark its trust entry revoked, remove its fingerprint from the
  accepted pin configuration, and require separately authorized generation,
  independent fingerprint verification, and enrollment of a replacement key.
  Re-issue any needed approvals with the replacement key.
- For planned rotation, enroll and independently pin the replacement key
  before its first use, verify it with synthetic tests, then revoke and retire
  the old key under an owner-approved cutover plan. Do not leave both keys
  active longer than the explicitly approved transition requires.
- On suspected key or signing-computer compromise, stop signing, treat all
  approvals made since the suspected compromise as untrusted, revoke the
  affected key, preserve incident evidence, and enroll a replacement only
  after a clean offline system and fresh independent fingerprint verification
  are established.
- After retirement, verify the old key is rejected, securely erase operational
  copies where practical, and record the retirement date and fingerprint.
  Retain no retired private key merely to preserve convenience; any archival
  exception requires an owner decision and documented controls.

#### Computer compromise and data handling

If the offline signing computer is compromised or its isolation is uncertain,
assume the private key and every approval it signed may be compromised.
Disconnect it, stop signing, revoke the key, and follow the compromise
procedure above. Do not trust signatures produced after the earliest plausible
compromise.

If the preparation computer is compromised, assume the source inventory,
approval files, candidate, logs, and any private Library material accessible
to that computer may have been read or altered. Do not use or publish its
candidate. Preserve incident evidence, isolate the machine, re-establish a
clean preparation environment, regenerate and independently review inventory
hashes, and obtain a new approval before preparing again. A preparation-machine
compromise does not by itself expose an offline private key, but can falsify
local verification or disclose source documents.

Never store private keys, passphrases, signed approvals, signatures, trust
configuration, or private Library payloads in Git, public R2, GitHub Pages
artifacts, public Actions artifacts, build output, or logs. Keep them outside
the repository and deployment workspace; disable verbose data dumps and avoid
printing record contents or file paths containing private source details.
Only a separately authorized future CI design may retrieve a least-privilege
snapshot, and it must not retrieve signing keys or approvals.

#### Owner checklist and authorization gates

**Decisions to record before execution**

- [ ] Name the signing authority and any independent reviewer.
- [ ] Approve the offline device, cryptographic tool, passphrase handling,
  backup locations, access controls, and recovery contact/procedure.
- [ ] Approve the independent fingerprint comparison channel and the protected
  location from which the preparation command receives its pin.
- [ ] Set the maximum approval validity period and the trusted-clock
  requirement.
- [ ] Approve key rotation, emergency revocation, loss recovery, and retirement
  procedures.
- [ ] Confirm that approvals are reusable for the signed hashes until expiry
  and that no replay ledger is required.
- [ ] Confirm that concurrent malicious modification of trusted local
  directories remains outside the current threat model.

**Fresh explicit authorization required for each execution**

- [ ] Generating a production signing key or its backups.
- [ ] Establishing or changing the trusted fingerprint, trust store, or key
  status.
- [ ] Creating or signing a real approval for specific inventory hashes.
- [ ] Preparing a real snapshot candidate from Library sources.
- [ ] Uploading a snapshot, changing R2, configuring CI retrieval, or publishing
  or deploying a site.
- [ ] Revoking, rotating, recovering, or retiring a production key.

Completing this plan is not approval to perform any checklist execution step.

## Git Freeze Helpers

Repository helper scripts used during v1 baseline setup:

- scripts/freeze-backend-v1.cmd
- scripts/tag-backend-v1.cmd
- scripts/verify-backend-v1.cmd
