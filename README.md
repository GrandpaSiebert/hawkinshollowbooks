# Hawkins Hollow Books Static Site Generator

This project is a small static-site generator that uses shared layouts, reusable components, and separate JSON data files.

It now includes a Library Scanner that treats `Library/` as a content repository and generates machine-readable indexes under `generated/`.

## Authoritative build system

Use the JavaScript generator as the single source of truth. The Python script is intentionally deprecated and should not be used for new work.

## Publishing principle

The local `Library/` is the authoritative working environment. The publishing engine is responsible for adapting it to distribution targets (R2 object keys, manifests, and bucket-specific publish flows).

Do not reorganize the local `Library/` to match cloud storage prefixes. Update `data/library-publish-mapping.json` when published key structure needs to change.

## Structure

- `layouts/` shared page templates
- `components/` reusable UI fragments
- `content/` placeholder content blocks
- `data/` separate JSON data collections
- `scripts/` generation logic
- `generated/` scanner and index outputs (auto-generated)
- `build/` generated site output

## Data files

- `data/site.json` global site metadata
- `data/navigation.json` navigation links
- `data/pages.json` page definitions
- `data/series.json` series definitions
- `data/books.json` book definitions
- `data/characters.json` character definitions
- `data/places.json` place definitions
- `data/resources.json` resource definitions
- `data/updates.json` community updates

## Build and preview

From the project root, run:

```bash
node scripts/generate-site.js
```

This command also refreshes the Library artifacts before writing HTML output.

To run only the scanner and indexer:

```bash
node scripts/scan-library.js
```

Then preview the generated site locally with:

```bash
node scripts/preview-site.js
```

Open http://localhost:8080/ in a browser.

## Publish to GitHub Pages

This repository deploys through GitHub Actions using `.github/workflows/deploy-pages.yml`.

After you make changes, publish with one command from the project root:

```bash
npm run publish:pages
```

Optional custom commit message:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/publish-pages.ps1 -Message "Publish summer update"
```

The publish script builds the site, commits any pending changes, and pushes to `origin/main`.
GitHub Actions then deploys `build-recovery/` to Pages.

## Library scanner outputs

- `generated/library-scan.json` full directory and file inventory (folders, filenames, extensions, sizes, timestamps)
- `generated/library-index.json` index optimized for site features (book IDs, titles, series, and associated files)

## Amazon catalog outputs

- `generated/amazon-index.json` canonical Amazon workbook index (IDs, status, ASINs, URLs, ISBN fields, and publication metadata)
- `generated/amazon-kdp-index.json` legacy compatibility copy of the same data

## Merged records

- `generated/merged-book-index.json` merged records combining Library discovery data and Amazon catalog metadata for each indexed book

## Entity index

- `generated/entity-index.json` typed world index generated at build time.
- Current typed buckets:
	- books
	- characters
	- relationships
	- environments
	- landmarks
	- activities
	- resources
- The index prefers authoritative structured sources (data JSON + generated merged indexes) and stores canonical source-document references for world canon files discovered in Library.
- This is intended to help every page and feature ask one question: “what entities exist, and what do we already know about them?”

## Entity graph and provenance

- `generated/entity-graph.json` models typed nodes and edges derived from canonical entity mentions.
- Each edge stores provenance metadata so relationships stay explainable:
	- source artifact
	- source document
	- extraction method
- The graph is intended as a shared relationship layer for page generation, search, recommendations, and future apps.

## Character canon ingestion

- `generated/character-canon-index.json` is generated from authoritative character canon DOCX files in `Library/Characters` and `data/characters.json`.
- It stores source-document links, excerpted canon text, and detected mention cues that are then attached to character entities in `generated/entity-index.json`.
- Search records for characters are built from this entity layer, so character metadata improvements in canon docs flow into search without page-level edits.

## World canon reader

- `generated/world-canon-index.json` is generated from authoritative canon DOCX files in:
	- `Library/Relationships`
	- `Library/Environments`
	- `Library/Landmarks`
- Additional typed outputs are generated for convenience:
	- `generated/relationship-canon-index.json`
	- `generated/environment-canon-index.json`
	- `generated/landmark-canon-index.json`
- `generated/entity-id-registry.json` stores stable generated IDs for non-book entities so identifiers remain consistent across builds.
- Dedicated importer modules are available for pipeline symmetry:
	- `scripts/relationship-canon-import.js`
	- `scripts/environment-canon-import.js`
	- `scripts/landmark-canon-import.js`

## Auto-generated book pages

- During `node scripts/generate-site.js`, the build now creates one HTML page per indexed Library book in `build-recovery/books/`.
- The Books page links directly to these generated detail pages.
- Current output count should match `generated/library-index.json` (`summary.indexedBooks`).

## Search index

- During `node scripts/generate-site.js`, the build also creates `generated/search-index.json`.
- The search index uses typed records so it can grow beyond books over time:
	- books
	- characters
	- relationships
	- environments
	- landmarks
	- activities
	- resources
- The Books page loads this generated index and performs client-side search by ID, title, series, and ASIN.

## How to add content

- Add a page in `data/pages.json`
- Add a navigation item in `data/navigation.json`
- Add a series in `data/series.json`
- Add books in `data/books.json`
- Add a character in `data/characters.json`
- Add a place in `data/places.json`
- Add a resource in `data/resources.json`
- Add an update in `data/updates.json`

Use placeholder image filenames such as `images/placeholder-banner.jpg` or `images/placeholder-cover.jpg` until final assets arrive.

## Under-construction fallback

Any page that has not yet been fully built will render a friendly placeholder message using the content in `data/under-construction.json` so links remain usable during development.

## Editorial review mode

The generated site now exposes preview text from `data/site-config.json`. No new copy should be considered approved until it is reviewed and confirmed.

## Experience and hospitality guidance

Hawkins Hollow uses a dedicated experience and voice constitution:

- See docs/Hawkins-Hollow-Promise.md for the Technical, Creative, Hospitality, and Stewardship constitutions.
- See docs/Hawkins-Hollow-Voice.md for voice rules and seasonal writing standards.
- Apply those documents to all copy, navigation, seasonal updates, and feature decisions.

## Documentation map

- docs/Architecture.md: system architecture and technical constitution
- docs/Build-Pipeline.md: build and ingestion workflow
- docs/Hawkins-Hollow-Promise.md: hospitality and experience constitution
- docs/Hawkins-Hollow-Voice.md: writing and voice rules
- docs/Contributor-Checklist.md: stewardship review checklist for contributors
- docs/Foundational-Docs-Policy.md: change policy for stable guiding documents
