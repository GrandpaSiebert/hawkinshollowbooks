# Architecture Decision Records

Architecture documents describe principles, not implementations.

If code changes without changing a principle, these documents should not change.

If a principle changes, record the new decision in a new ADR rather than rewriting history.

## Purpose

This directory stores short, durable Architecture Decision Records (ADRs) for Hawkins Hollow.

Each ADR captures four items only:

- Decision
- Why
- Alternatives considered
- Consequences

## How To Use This Folder

- Add a new ADR when a significant architectural decision is made.
- Add a new ADR when a prior decision is intentionally replaced.
- Add a new ADR when production learning proves a prior decision should change.
- Do not rewrite old ADRs except for typo fixes.

## ADR Status And Superseding

When a decision changes:

- Keep the old ADR as historical record.
- Create a new ADR with the next number.
- In the new ADR, state which older ADR it supersedes.
- Optionally add a one-line note in the older ADR: Superseded by ADR-XXX.

## ADR Index

- ADR-001: Local Library is authoritative.
- ADR-002: Manifest-driven publishing.
- ADR-003: R2 mapping translation layer.
- ADR-004: Family learning framework.
- ADR-005: Website and content separation.
- ADR-006: Publishing engine as Trusted Infrastructure.
- ADR-007: One Production Pain Rule.
