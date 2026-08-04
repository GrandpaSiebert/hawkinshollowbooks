# Hawkins Hollow Narration Grammar

## Purpose

Hawkins Hollow should feel recognizable across page types, even as content grows.

Narration grammar defines the visitor-facing order of meaning so pages feel like one place instead of disconnected assets.

## Core Grammar

Use this rhythm in visitor-facing page sections:

1. Welcome.
2. Why this matters.
3. What it is.
4. What to do next.

This is an experience-order rule, not a canonical-data rule.

## Separation Of Responsibilities

- Canonical layer owns what is true.
- Renderer layer chooses what is shown first.
- Voice layer decides how invitation and purpose are expressed.

Do not make canonical records emotional.
Do make rendered experiences human.

## Source-Origin Rule

Visitor prose should be generated from canonical knowledge, not copied from canonical documentation.

Use canon to determine facts, relationships, and boundaries.
Use renderer and voice to express those facts in visitor-facing language.

If a sentence could be lifted directly from canon-oriented documentation, treat it as potential narration leakage and rewrite it for visitor context.

## Progressive Disclosure Rule

Show the minimum information needed for a visitor to decide whether to continue.

Reveal implementation details only when they are useful or explicitly requested.

Typical behavior:

- Visitor mode: invitation, purpose, story connection, next path.
- Developer mode: identifiers, files, status, relationships, diagnostics.

## Narration Grammar Exception Policy

The host grammar is the default for all visitor-facing pages.

Any intentional deviation must:

- document why the default sequence does not serve the visitor,
- preserve welcome-first ordering,
- maintain first-arrival orientation,
- and provide a clear next path.

Exceptions should be rare, explicit, and reviewed.

## Scope

This grammar applies to:

- stories
- characters
- places
- relationships
- resources
- activity paths

## Litmus Test

After thirty seconds on a page, ask:

- Do they remember why this mattered?
- Do they know what to do next?

If they remember metadata first, narration failed.

## Related Documents

- docs/Architecture.md
- docs/Hawkins-Hollow-Voice.md
- docs/architecture/book-experience-pattern.md
- docs/architecture/resource-experience-pattern.md
- docs/Contributor-Checklist.md