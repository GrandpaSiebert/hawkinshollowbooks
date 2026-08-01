# Publishing Engine v1.0

Date tagged: 2026-07-31  
Release tag: publishing-engine-v1.0

## Why v1.0 was tagged

The publishing subsystem reached a stable operational baseline and shifted from architecture exploration to production use.

This release marks the point where publishing changes should be driven by real usage and operational pain points, not speculative feature work.

## Problems this solved

- Removed dependency on serving local library files directly.
- Established manifest-driven publishing for cloud distribution.
- Added preview-first publishing workflow with integrity reporting.
- Added rollback support and publish history artifacts.
- Added test-bucket and production-bucket publish paths.
- Added hash-based changed-file uploads with multipart support.

## Core design principles

- The local Library is authoritative for day-to-day creative work.
- The publishing engine translates local structure into distribution structure.
- Manifest output is the source of truth for published catalog state.
- Mapping rules define local-to-R2 key translation.
- Deployment order is manifest-last to avoid partial availability windows.
- Operational safety features (preview, verification, rollback) are mandatory.

## Workflow contract

Working model:

Local Library -> Publishing Engine -> Cloudflare R2

Do not reorganize local Library folders to match cloud prefixes.
Update mapping rules instead.

## Governance rule

No new publishing features without a production pain point.

## What changes next

Publishing infrastructure is considered complete at v1.0.
Primary focus shifts to content and family experience:

- New books
- New companion packs
- Character and world expansion
- Ongoing quality observations from real readers
