# ADR-006: Publishing Engine As Trusted Infrastructure

## Decision

The publishing engine is designated Trusted Infrastructure.

Trusted Infrastructure has one job: it quietly works.

It is not treated as a recurring redesign target unless production evidence shows reliability, safety, or workflow harm.

## Why

The current bottleneck is no longer architecture redesign. The product gains more from content creation and family learning loops than from continual infrastructure churn.

A stable publishing core lets the team focus on stories, companion experiences, and measurable family outcomes.

## Alternatives Considered

- Continue frequent architecture redesign cycles.
- Treat infrastructure as the primary innovation surface.

## Consequences

- Operational discipline is prioritized over novelty in publishing internals.
- Publishing follows strict execution order: preview, integrity review, publish, verify, archive.
- Improvements are evidence-led and incremental.
- Milestones are intentionally recognized to reinforce reliability culture.
