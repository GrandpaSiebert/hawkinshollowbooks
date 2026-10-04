# Hawkins Hollow Books Static Site Generator

## New to Hawkins Hollow?

Before exploring the repository, start with the [docs/Repository-Preface.md](docs/Repository-Preface.md) document. It explains the purpose of the project and the role each document plays in preserving it.

Recommended onboarding order:

1. Read [docs/Hawkins-Hollow-Design-Charter.md](docs/Hawkins-Hollow-Design-Charter.md).
2. Read [docs/Chapter-4-Tend-the-Neighborhood.md](docs/Chapter-4-Tend-the-Neighborhood.md).
3. Read production documents only when you are doing production work.

This repository is a small static-site generator that uses shared layouts, reusable components, and separate JSON data files. It also includes a Library Scanner that treats `Library/` as a content repository and generates machine-readable indexes under `generated/`.

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

### Deployment-aware IndexNow

After a successful Pages deployment, the workflow notifies `https://api.indexnow.org/indexnow` only about added, materially changed, or removed indexable canonical pages. The existing root verification key file is public by protocol; it is not a private repository credential. IndexNow acknowledgement does not guarantee indexing.

`scripts/indexnow-deployment.js` reads the sitemap, requires each page's exact HTTPS production canonical and absence of `noindex`, and SHA-256 fingerprints its parsed public HTML. Text, headings, links, images, metadata, and normalized JSON-LD participate. Comments, whitespace/layout-only attributes, stylesheet references, executable browser scripts, build-only timestamp metadata, and hidden developer provenance do not. Git changes, build timestamps, and template filenames never select URLs on their own. Migration stubs, retired freebie entity routes, verification files, infrastructure, and assets are ineligible.

The first adoption run establishes the 1,499-page baseline without submitting existing URLs. Future runs compare actual snapshots and deduplicate added/updated/deleted candidates plus pending retries. Deleted URLs retain evidence in the previous snapshot or pending journal even after their HTML file disappears.

The immutable `indexnow-production-state-<run>-<attempt>` Actions artifact contains `state.json`, `receipt.json`, and `plan.json`, retained for 90 days and never published in the website. Per-attempt names avoid rerun collisions; reruns can recover the previous attempt's pending journal. It is preferred over an evictable cache. Retrieval verifies the workflow, main branch, successful Pages step, deployment SHA/run ID, snapshot version, and content hashes. API/retrieval/integrity failures do not silently become first-run resets. A recent deployed run missing its state artifact blocks the next deployment: re-run that affected workflow to recover the journal. After retention has genuinely elapsed, a fresh baseline suppresses historical backfill; notifications no longer retained cannot be recovered automatically.

Planning occurs after the normal build/validators; notification and production-state advancement occur only after Pages success. Production runs are serialized without cancelling an in-progress run. Failed builds/deployments neither notify nor advance state. The deployed snapshot and pending URLs are checkpointed before any request, then after each bounded batch (at most 10,000 URLs). Only HTTP 200/202 acknowledgement clears pending URLs; 202 explicitly records pending key validation. Malformed requests, key/host problems, throttling, network/5xx failures, and unattempted batches remain pending. There is one attempt per batch, stopping on failure, not an infinite retry loop.

Notification failure warns and marks the notification step failed with `continue-on-error`; it does not undo successful Pages deployment. The state/receipt artifact is still retained. A subsequent successful deployment, workflow dispatch, or re-run retries pending canonical notifications. Artifact persistence failure is an actual workflow failure, not silently ignored; recover by re-running that deployment. Receipts include SHA, baseline/snapshot IDs, delta counts, submitted/accepted/pending counts, URLs, batches, protocol results, and timestamps, but no private tokens or raw response bodies.

For an offline, non-submitting preview after building:

```bash
npm run indexnow:prepare
npm run indexnow:submit:dry-run
```

Local preview cannot claim a trustworthy CI baseline. `indexnow:submit` requires the prepared deployment SHA/run and explicit Pages-success gate. The old direct URL/whole-sitemap CLI is intentionally blocked. Run generator integration tests serially: `node --test --test-concurrency=1`.

### Document/search titles

The generator keeps HTML document titles separate from canonical work titles,
visible headings, and the existing OG/Twitter title. Short Song/Rhyme titles
retain branding when it fits the 60-character design target; longer titles omit
branding first. Only titles still over 60 receive equivalent whole-phrase
abbreviations. An exact trailing catalog sequence may be omitted; arbitrary
numbers, words, and character ranges are never truncated.

`scripts/search-title-overrides.js` contains reviewed metadata-only exceptions
keyed by canonical HH ID, with the expected source title and a rationale.
Changed source titles invalidate their override rather than silently reusing it.
Book-character document titles use the indexed route title plus `Characters`,
without branding; their existing H1 and social-title ownership remain separate.

After rendering, `scripts/search-titles.js` checks every sitemap canonical and
adds a semantic page-family label only to colliding document titles. Both output
trees receive only the corrected `<title>` text, not rewritten body markup.
Generation fails for accidental collisions, invalid/empty titles, ellipsis
shortening, or titles over 70 without a documented exact-title exception.
60 is preferred; 61-65 and 66-70 are reported for review. These are internal
quality targets, not a claim about Bing's official threshold.

Run the focused regression with `node --test test/search-titles.test.js`.
Run all generator tests serially with `node --test --test-concurrency=1`.

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

- docs/Repository-Preface.md: introduction to the project’s character, purpose, and documentation ecosystem
- docs/Hawkins-Hollow-Design-Charter.md: constitutional purpose and enduring design principles
- docs/Chapter-4-Tend-the-Neighborhood.md: current stewardship practice for daily work
- docs/Architecture.md: system architecture and technical constitution
- docs/Build-Pipeline.md: build and ingestion workflow
- docs/Hawkins-Hollow-Promise.md: hospitality and experience constitution
- docs/Hawkins-Hollow-Voice.md: writing and voice rules
- docs/Contributor-Checklist.md: stewardship review checklist for contributors
- docs/Visitor-Improvement-Log.md: pass-by-pass evidence log for Visitor Improvement Loop outcomes
- docs/Foundational-Docs-Policy.md: change policy for stable guiding documents
- docs/architecture/README.md: ADR policy and architecture decision index
- docs/architecture/ADR-006-publishing-engine-trusted-infrastructure.md: trusted infrastructure designation for publishing
- docs/architecture/ADR-007-production-pain-rule.md: infrastructure change only when production pain proves need
