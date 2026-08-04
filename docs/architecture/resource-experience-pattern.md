# Resource Experience Pattern

## Purpose

A resource page is not a record dump. It is the visitor's invitation to continue spending time in Hawkins Hollow.

The first responsibility of a resource card is to answer why someone would want it. The second responsibility is to identify what it is. Canonical metadata supports the system, but it should not lead the visitor experience.

## Scope Boundary

This document is a design principle, not a page-specification.

It defines the experience resource pages and resource cards should create, while implementation details remain downstream.

## Core Principle

Every resource should answer "Why would I want this?" before it answers "What is this?"

Visitor-facing resource cards should follow a consistent grammar:

1. Headline or invitation sentence
2. Purpose or benefit statement
3. Story connection or next path

Developer-facing views may expose the full registry record, including IDs, source files, status, relationships, and diagnostics.

## Visitor Mode

Visitor mode should feel like a welcome, not a schema.

Preferred flow:

- welcome
- purpose
- experience
- next path

Visitor mode should emphasize:

- why the resource matters
- who it helps
- how it connects to the story
- what the visitor can do next

## Developer Mode

Developer mode is for the canonical registry and maintainers.

It may include:

- resourceId
- resourceType
- status
- sourceFile
- structural relationships
- world relationships
- shared connections
- diagnostics

Developer mode should remain available, but it should not lead the visitor experience.

## Narrative Rule

Every resource card should quietly answer:

> What happens next?

Not with instructions, but with an invitation.

Examples:

- Read the story.
- Meet Spencer.
- Walk Burrow Path.
- Try another activity.
- Visit Grandpa.
- Continue your journey.

## Litmus Test

When someone leaves a resource page, they should remember the invitation, the purpose, and the next path.

Practical check:

- After thirty seconds on the page, what do they remember?
- If they remember metadata first, the page failed.
- If they remember why the resource matters and where to go next, the page succeeded.

## Visitor Compass

Does this help someone leave Hawkins Hollow a little better than they arrived?

## Related Guidance

- docs/Architecture.md
- docs/Hawkins-Hollow-Voice.md
- docs/Contributor-Checklist.md