# Book Experience Pattern

## Purpose

A book page is not a library record. It is the visitor's introduction to one story within Hawkins Hollow.

The page's first responsibility is to help a visitor decide whether they would enjoy spending time with this story. Technical and bibliographic information supports that purpose but must not replace it.

## Scope Boundary

This document is a design principle, not a page-design specification.

It defines the experience each book page should create, while implementation details (HTML, CSS, templates, and components) remain downstream.

## Companion Questions

Use these together when shaping a page:

- Where does this belong?
- What does the visitor need to feel first?

The first protects architectural coherence. The second protects visitor experience.

## First Screen

The first screen should answer four questions naturally:

1. Who is this story about?
2. What kind of experience can I expect?
3. Why might I enjoy it?
4. Where can I go next?

## Story Before Structure

Lead with:

- cover art
- welcoming introduction
- spoiler-free synopsis
- featured characters
- places you will visit
- what you will discover
- natural next steps

Technical metadata belongs lower on the page.

## Technical Information

Canonical IDs, production mode, file inventory, publishing metadata, and other implementation details are part of the permanent library record, but they are secondary to the visitor experience.

Implementation details are not part of the visitor experience. Reveal only information that helps the visitor understand, enjoy, or continue their journey through Hawkins Hollow.

## Litmus Test

When someone leaves this page, they should remember Spencer's adventure, not FR001.

Practical check:

- After thirty seconds on the page, what do they remember?
- If they remember metadata first, the page failed.
- If they remember story, characters, places, and want to continue, the page succeeded.

## Visitor Compass

Does this help someone leave Hawkins Hollow a little better than they arrived?

Execution note:

- Run redesign work through the Visitor Improvement Loop in docs/Contributor-Checklist.md.
