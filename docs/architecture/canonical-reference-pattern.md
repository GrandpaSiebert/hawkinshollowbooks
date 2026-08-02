# Canonical Reference Pattern

A Golden Record is the first complete expression of canonical truth for an entity.

The Canonical Reference Pattern is the architecture that Golden Records instantiate.

## Purpose

A Golden Record demonstrates the complete canonical expression of one entity before that pattern is applied at scale.

## Book Golden Record Requirements

A book Golden Record should declare:

- identity
- characters
- environments
- related books
- experience hooks (when available)
- journeys (when available)

For current Book Model usage in this repository, required canonical reference arrays are:

- characters
- environments
- relatedBooks

## Validation Gate

A Golden Record becomes the reference implementation only after strict validation passes:

- Preflight - Governance
- Layer 1 - Identity Format
- Layer 2 - Identity Uniqueness
- Layer 3 - World Resolution

Interpretation rule:

- A pass is meaningful only when references are actually present and resolved.
- Zero-reference passes validate tooling readiness, not declared world traversal.

## Story Integrity Meaning

When World Resolution resolves declared references, validation confirms narrative traversability inside canonical world truth.

For a book record, that means declared characters, places, and related books can be resolved as real canonical entities.

## Scaling Rule

Future records replicate the pattern.

They do not redefine it.

Pattern changes require an explicit architecture decision before additional record authoring.

## Authoring Rhythm

Use this order for future expansion:

1. Discover a principle.
2. Express it once.
3. Validate it.
4. Document it.
5. Scale it.
