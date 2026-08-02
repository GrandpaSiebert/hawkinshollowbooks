# ADR-008: Authority-First Canon Governance

## Decision

Hawkins Hollow architecture is governed by separation of authority.

- World Model defines reality.
- Canonical Asset Model defines identity representation and invariants.
- Experience Profiles define emotional consistency.
- Visit Journeys define visit-scoped intent.
- Experience Templates define composition.
- Renderers define medium-specific presentation.

No lower layer may rewrite truth owned by a higher layer.

Future work should scale by adding expressions, not re-arguing truth.

## Why

As Hawkins Hollow expanded from books into a website, visual canon, production system, and future media, it became necessary to distinguish world truth from presentation. This ADR establishes an authority-first governance model so that every expression of Hawkins Hollow is derived from a single canonical source rather than redefining it.

The project is no longer a website-first system. It is a world-first system with multiple outputs.

An authority-first model prevents drift where channels (website, print, app, marketing) invent competing versions of Hawkins Hollow. It preserves both identity (what Hawkins Hollow is) and experience consistency (how Hawkins Hollow feels) across media.

## Alternatives Considered

- Continue with renderer-led evolution where implementation convenience can reshape domain truth.
- Keep all behavior in templates and renderers without explicit ownership boundaries.
- Treat journeys as character-fixed instead of visit-scoped, limiting context-aware experiences.

## Consequences

- Canonical changes must be justified as world-truth changes.
- Presentation changes can move quickly without destabilizing domain truth.
- New outputs (web, print, classroom, mobile, future) can reuse the same canon.
- Architecture discussions gain a shared vocabulary: canon, profile, journey, template, renderer, authority.

The purpose of this decision is not to constrain future expressions of Hawkins Hollow, but to ensure they all remain faithful expressions of the same world.
