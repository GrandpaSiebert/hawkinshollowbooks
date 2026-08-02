# Canonical Asset Model

The purpose of the Hawkins Hollow Canon is to preserve the identity of the world while allowing its expression through many forms of media.

This document answers: How is that world represented? It defines the technical contract for canonical identifiers, ownership, references, and representation boundaries so every medium can render the same world consistently.

## Decision

Hawkins Hollow uses a canonical asset model as one chapter of a larger world model. Every asset has one immutable canonical identifier, one presentation title, one production mode, and one or more experience profile references that describe how the visitor should encounter it.

## Why

The canon must stay stable across web pages, print output, internal tools, QR codes, KDP metadata, and future platforms. Presentation should vary by channel without changing identity.

## Canonical Shape

- Canonical ID: immutable primary identifier from the source system.
- Public Title: visitor-facing presentation name.
- Production Mode: publishing specification that defines trim size, page count, illustration rules, and related build behavior.
- Experience Profile: the canonical personality and emotional constraints of the character/place.
- Journey (Visit-Scoped): the emotional beat sequence for this specific visit context (first-time, returning, classroom, seasonal, etc.).
- Experience Template: reusable structural expression of journey beats for a medium.
- Related data: relationships, places, stories, images, and other canon-linked material.

## Rules

- Canonical IDs are part of the Hawkins Hollow canon and are never generated, abbreviated, renumbered, or translated.
- Every outward expression of Hawkins Hollow is a faithful rendering of the canon. No renderer owns truth; each renderer interprets the same canonical world for a different audience or medium.
- Every canonical edit must be justified as a world-truth change, not a renderer convenience.
- Production modes define physical and editorial specifications and should be modeled as reusable configuration, not page text.
- Public titles are presentation metadata and may differ by channel.
- Experience profiles are canonical and stable; journeys are selected per visit context.
- Experience templates consume canonical assets and visit-scoped journeys; they do not replace them.
- Renderers must not invent identifiers.
- URLs are independent of canonical IDs and may be shaped for usability or platform constraints.

## Journey Guardrail

- Journeys should be defined as emotional beats, not rigid page-section scripts.
- Recommended beat framing: feel welcomed, become curious, notice something small, feel connected, leave wanting one more step.
- Templates may express those beats differently by medium, audience, and context.

## Identity Symmetry

- Visual canon preserves how characters and places look.
- Experience profiles preserve how characters and places feel.
- Both are canonical constraints, not renderer decisions.

## Consequences

- The same asset can be rendered consistently across web, print, and internal tooling.
- Production changes stay localized to mode definitions.
- The build pipeline can derive presentation from the canonical object instead of inferring identity from filenames or page labels.
- Future work should scale by adding expressions, not re-arguing truth.
