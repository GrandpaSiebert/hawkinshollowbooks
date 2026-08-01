# ADR-003: R2 Mapping Translation Layer

## Decision

A mapping layer translates local Library paths into published R2 object keys.

## Why

R2 is an object store keyed by prefixes. A configurable translation layer allows published layout changes without forcing local workflow changes.

## Alternatives Considered

- Hardcode key mapping rules in publish scripts.
- Mirror local directory structure directly in R2 keys without abstraction.

## Consequences

- Mapping configuration becomes an intentional architectural artifact.
- Prefix strategy can evolve by changing mapping rules, not source organization.
- Publish behavior stays explicit, reviewable, and testable.
