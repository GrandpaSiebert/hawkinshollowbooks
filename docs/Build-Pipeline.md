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
