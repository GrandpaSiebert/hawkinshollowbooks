# Canonical Authority Registry

This registry defines canonical authority by entity type.

It answers two questions:

1. Who owns canonical truth for this entity?
2. Where is that truth currently resolved from?

## Purpose

Canonical authority is a governance contract, not a storage implementation detail.

Storage can change over time. Authority should remain explicit and stable.

## Registry File

Primary file:

- `data/canonical-authority-registry.json`

Deprecated compatibility file (not consumed by the build or QC):

- `data/canonical-source-registry.json`

Governance rule:

- `data/canonical-authority-registry.json` is authoritative.
- `data/canonical-source-registry.json` is historical compatibility data and is not
  regenerated or consulted by the site generator or canonical validator.
- Missing or invalid authority-registry data fails closed; consumers do not
  substitute built-in defaults or compatibility records.

## Entity Contract

Each entity may define:

- `canonicalAuthority`: named owner of canonical truth
- `canonicalSource`: current storage/artifact location for canonical truth
- `canonicalPath`: path inside the source payload to canonical records

For Library-backed World Canon, the indexed records are generated from the
current Library scan. The generated index is a build input to downstream
rendering, not an independent authority.

## Example Ownership

- Books -> Book Model
- Character directory metadata -> `data/characters.json`; character canon
  documents and their content -> `Library/Characters`
- Environments -> World Canon
- Relationships -> World Canon

Book identity and manuscript files come from the Library. Book Model fields
provide curated presentation metadata, while the unchanged root-level
`Amazon KDP Info.xlsx` determines KDP Live status.

## System Expectations

- The generator and canonical validator consume this same registry and source
  selection; validation applies additional checks without selecting alternate
  records.
- Library scans and importer outputs are refreshed for each build. Missing
  Library or required current World Canon records fail the build.
- Importers/exporters should adopt this registry instead of hardcoding source logic.

## Design Principle

Keep each authority explicit and avoid fallback chains that allow stale
projections to replace current source material.

Good:

- "Environments are owned by World Canon and resolved from the current
  Library-derived `byType.environments` projection."

Avoid:

- "If the Library is missing, use a prior generated index or a legacy JSON copy."
