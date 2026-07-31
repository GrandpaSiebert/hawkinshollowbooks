# Hawkins Hollow Architecture

This document describes how Hawkins Hollow is built.

## Core Model

Hawkins Hollow is built as a canonical-source, artifact-driven static platform.

1. Source content is treated as authoritative.
2. Build/import steps produce typed generated artifacts.
3. Pages and search experiences are generated from those artifacts.

## Authoritative Sources

- Library corpus in Library
- JSON content/config in data
- Canonical world and character docs in Library subfolders
- Amazon workbook metadata

## Key Generated Artifacts

- generated/library-scan.json
- generated/library-index.json
- generated/amazon-index.json
- generated/merged-book-index.json
- generated/character-canon-index.json
- generated/world-canon-index.json
- generated/relationship-canon-index.json
- generated/environment-canon-index.json
- generated/landmark-canon-index.json
- generated/entity-id-registry.json
- generated/entity-index.json
- generated/entity-graph.json
- generated/search-index.json

## Technical Constitution

- Canonical source files are authoritative.
- Stable entity IDs persist across builds.
- Relationship provenance is preserved on graph edges.
- Build pipelines generate repeatable artifacts.

## Runtime Outputs

- build-recovery contains generated site pages.
- Universal entity pages are generated under build-recovery/entities.
- Visitor search reads generated/search-index.json and graph context.

## Change Policy

Backend v1.0 is frozen as a baseline milestone.
New infrastructure should be added only when a visitor-facing experience requires it.
