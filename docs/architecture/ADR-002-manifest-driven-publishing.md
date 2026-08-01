# ADR-002: Manifest-Driven Publishing

## Decision

Published catalog state is defined by a generated manifest and validation pipeline rather than manual page-level linking.

## Why

A manifest provides a single machine-readable source of truth for assets and metadata, enabling deterministic publishing, preview checks, integrity reporting, and automation at scale.

## Alternatives Considered

- Manual linking in website files for each new asset.
- Direct dependency on local filesystem layout at runtime.

## Consequences

- Build and publish workflows depend on manifest generation and validation.
- Website consumes manifest-derived outputs rather than manual edits.
- Publishing can scale from one asset to thousands with consistent behavior.
