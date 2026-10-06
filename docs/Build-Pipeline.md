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
2. Import commerce/canon sources.
3. Merge book data.
4. Build typed entity index.
5. Build provenance-aware entity graph.
6. Build typed search index.
7. Render static pages and universal entity pages.

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

## Git Freeze Helpers

Repository helper scripts used during v1 baseline setup:

- scripts/freeze-backend-v1.cmd
- scripts/tag-backend-v1.cmd
- scripts/verify-backend-v1.cmd
