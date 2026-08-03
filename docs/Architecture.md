# Hawkins Hollow Architecture

This document describes how Hawkins Hollow is built.

Working definition:

- Hawkins Hollow is a community that introduces itself, one neighbor at a time.

## Core Model

Hawkins Hollow is built as a canonical-source, artifact-driven static platform.

The domain constitution is documented in docs/architecture/world-model.md, with field-level identity and production contracts in docs/architecture/canonical-asset-model.md, explicit canonical identity enforcement in docs/architecture/canonical-id-contract.md, authority ownership/source resolution in docs/architecture/canonical-authority-registry.md, Golden Record freeze-before-scale guidance in docs/architecture/canonical-reference-pattern.md, and story-first visitor journey guidance in docs/architecture/book-experience-pattern.md.

1. Source content is treated as authoritative.
2. Build/import steps produce typed generated artifacts.
3. Pages and search experiences are generated from those artifacts.
4. The website generator is one consumer of canon, alongside book/publishing pipelines and future outputs.

## Responsibility Layers

Each layer protects one responsibility.

- Canon Layer: What is true? Protect identity. Never drift.
- Introduction Layer: What should this neighbor naturally introduce next? Protect welcome. Never force.
- Discovery Layer: What part of the truth should be revealed today? Protect curiosity. Never replace truth.
- Presentation Layer: How can this feel effortless? Protect continuity. Never call attention to the machinery.

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
- Presentation may evolve indefinitely; canonical truth evolves intentionally.
- Stable entity IDs persist across builds.
- Relationship provenance is preserved on graph edges.
- Build pipelines generate repeatable artifacts.

## Experience Guardrail

The page should introduce the visitor to the story, not the story to the database.

Companion questions for implementation decisions:

- Where does this belong?
- What does the visitor need to feel first?

Visitor-purpose compass:

- Does this help someone leave Hawkins Hollow a little better than they arrived?

## Continuity And Discovery Guardrails

Stable world, dynamic window:

- Rotate windows, not truth.
- Discovery should deepen familiarity, never replace it.
- Context is persistent. Navigation is incidental.
- Every click should feel like continuing the same visit.
- A returning visitor should feel: I know this neighbor a little better.
- A returning visitor should not feel: this neighbor became someone else.

Front porch and living room separation:

- Front porch pages are curated introductions: short, welcoming, and selective.
- Living room pages are complete references: exhaustive, searchable, and stable.
- Rotation belongs on front porches; completeness belongs in living rooms.

Continuity brake for dynamic ideas:

- Ask: Does this reveal another part of the same neighbor, or make the neighbor feel different?
- If it makes the neighbor feel different, do not ship it.

## Stewardship And Hospitality

Hawkins Hollow is built on two parallel responsibilities:

- Stewardship asks: Where does this belong?
- Hospitality asks: What does the visitor need to feel first?

These questions prevent different forms of drift.

- Stewardship protects world integrity: truth, authority, identity, relationships, and validation.
- Hospitality protects visitor experience: welcome, curiosity, discovery, connection, and continuation.

Neither path is optional, and neither path replaces the other.

The destination is not the website itself, and not metadata visibility.

The destination is the feeling someone carries away after spending time in Hawkins Hollow.

## Runtime Outputs

- build-recovery contains generated site pages.
- Universal entity pages are generated under build-recovery/entities.
- Visitor search reads generated/search-index.json and graph context.

For operational details about how the generator writes output and where to verify built pages, see docs/Build-Pipeline.md. Architecture documents the model and responsibilities; build documentation documents the current runtime behavior.

## Change Policy

Backend v1.0 is frozen as a baseline milestone.
New infrastructure should be added only when a visitor-facing experience requires it.
Canonical model changes should be introduced only when world truth changes, not because a renderer or channel prefers a different shape.
