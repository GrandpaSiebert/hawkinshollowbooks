# World Model

This document answers: What is Hawkins Hollow? It defines the ontology of the world itself, including entities, relationships, and domain-level meaning independent of any output medium.

## Purpose

This document is the constitutional model for the domain. Other architecture docs should reference this model when defining specific contracts.

## Core Domain Entities

- Characters
- Places (environments and landmarks)
- Stories
- Relationships
- Families and communities
- Production modes
- Experience profiles
- Visit journeys

## Authority Boundaries

- Canon owns identity, relationships, personality constraints, and production semantics.
- Renderers own medium-specific presentation only.
- Generated artifacts are derived expressions of canon and must be reproducible.

## Canonical Change Filter

Every canonical change must answer one question: What truth about Hawkins Hollow has changed?

- Canonical examples: a character identity update, a production mode specification update, or a canonical experience-profile assignment update.
- Non-canonical examples: layout optimization, card sizing, ordering preferences, or channel-specific display truncation.

If a proposal cannot describe a world-truth change, it should be implemented below the canonical layer.

## Canon To Output Flow

1. Canonical domain entities
2. Experience profile selection
3. Visit-scoped journey selection
4. Experience template mapping
5. Renderer output (HTML, print, mobile, and future targets)

## Separation Of Authority

- World Model has authority over reality.
- Canonical Asset Model has authority over identity representation and invariants.
- Experience Profile has authority over emotional consistency.
- Journey has authority over visit intent.
- Template has authority over composition patterns.
- Renderer has authority over medium-specific presentation.

No lower layer rewrites the truth owned by a higher layer.

## Immutability And Variability

- Immutable: canonical IDs, core identity, canonical relationships, profile constraints.
- Variable: public titles by channel, URL shapes, visit journey choice, template composition, and renderer-level presentation details.

## Relationship To Canonical Asset Model

The canonical asset model defines the field-level contract for identifiers, production metadata, and template inputs.
This world model defines the higher-level ontology and ownership boundaries those contracts operate within.
