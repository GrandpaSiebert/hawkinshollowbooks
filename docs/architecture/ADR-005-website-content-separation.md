# ADR-005: Website And Content Separation

## Decision

The website presentation layer is separated from content storage and publishing infrastructure.

## Why

Clear separation of concerns reduces coupling: creators focus on content, publishing engine handles transformation and deployment, and website focuses on experience delivery.

## Alternatives Considered

- Keep content, transformation logic, and presentation tightly coupled in one layer.
- Serve source content directly from local structures without a publishing boundary.

## Consequences

- Platform responsibilities are explicit across creation, publishing, and distribution layers.
- Website can remain stable while content volume and publishing complexity grow.
- Operational reliability improves through layer-specific validation and controls.
