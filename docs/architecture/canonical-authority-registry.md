# Canonical Authority Registry

This registry defines canonical authority by entity type.

It answers two questions:

1. Who owns canonical truth for this entity?
2. Where is that truth currently resolved from?

## Purpose

Canonical authority is a governance contract, not a storage implementation detail.

Storage can change over time. Authority should remain explicit and stable.

## Registry File

Primary file:

- `data/canonical-authority-registry.json`

Compatibility file (legacy name):

- `data/canonical-source-registry.json`

When both exist, systems should prefer the authority registry.

Governance rule:

- `data/canonical-authority-registry.json` is authoritative.
- `data/canonical-source-registry.json` is a deprecated compatibility projection only.
- The legacy file must be generated from the authority registry and never hand-edited.
- Validation must fail if overlapping declarations drift.

## Entity Contract

Each entity may define:

- `canonicalAuthority`: named owner of canonical truth
- `canonicalSource`: current storage/artifact location for canonical truth
- `canonicalPath`: path inside the source payload to canonical records
- `compatibilitySource`: optional transitional fallback source
- `compatibilityPath`: path inside compatibility source payload

## Example Ownership

- Books -> Book Model
- Characters -> Character Canon
- Environments -> World Canon
- Relationships -> World Canon

## System Expectations

- Validators consult this registry to explain active authority and source.
- Generators consult this registry to resolve canonical records declaratively.
- Importers/exporters should adopt this registry instead of hardcoding source logic.

## Design Principle

Prefer declarative authority over procedural source checks.

Good:

- "Environments are owned by World Canon and currently resolved from byType.environments."

Avoid:

- "If world-canon-index exists, use it."
