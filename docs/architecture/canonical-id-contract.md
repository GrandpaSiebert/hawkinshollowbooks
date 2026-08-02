# Canonical ID Contract

This document defines the canonical identity constitution that validation and rendering must enforce.

## Purpose

Canonical IDs protect world truth from presentation drift.
The validator does not invent rules; it enforces this contract.

## Identity

- Canonical IDs are immutable once assigned.
- Every first-class canonical entity has exactly one canonical ID.
- Canonical IDs are never derived from titles, slugs, filenames, display order, or UI labels.
- Renderers may display labels, but renderers may not create or transform identity.

## Identity Object Convention

All first-class entities should follow one explicit identity pattern:

```
{
	"identity": {
		"canonicalId": "...",
		"legacyAliases": []
	}
}
```

Rules:

- `identity.canonicalId` is authoritative identity.
- `identity.legacyAliases` is compatibility history only.
- Legacy aliases are optional and should be empty when not needed.
- Top-level legacy fields (for example `code`) are transitional and should be removed after migration.

## Format

### Publication/Book IDs (current required contract)

Format:

`HH-[MODE]-NNNN`

Examples:

- `HH-A-0001`
- `HH-B-0001`
- `HH-C-0047`

Where:

- `HH` is the Hawkins Hollow namespace.
- `[MODE]` is the production mode code.
- `NNNN` is a zero-padded sequence within that mode.

Regex for publication IDs:

`^HH-[A-Z]-[0-9]{4}$`

### Other canonical entity families

Non-publication entities (characters, environments, landmarks, relationships, and future families) must also use immutable canonical IDs, but their exact structural pattern remains governed by current canonical sources until explicitly superseded by a dedicated contract revision.

## Authority

- Canonical source data is the only authority that may define IDs.
- Build and renderer layers may read canonical IDs, but may not mint, renumber, abbreviate, or alias new identities.
- Any ID format evolution requires an explicit architecture decision update.

## References

- All canonical references must target canonical IDs.
- References must not use titles, filenames, slugs, display labels, or positional order as identity.
- Relationship edges must resolve to existing canonical entities.

## Migration Policy

- Legacy IDs (for example `SB001`) are compatibility aliases only.
- No new code or new data may introduce legacy presentation IDs.
- Migration aliases should be removed once all references are canonical.

## Validator Enforcement Layers

Validator implementation should enforce this contract in layers:

Preflight (outside numbered layers):

- Authority Registry: ensure canonical-authority-registry is available and structurally valid.
- Projection Drift: fail when deprecated canonical-source-registry disagrees on overlapping fields.
- Registry Integrity: ensure entity-level authority/source/path declarations are coherent.

World Resolution principle:

- World Resolution never creates truth. It discovers whether the declared world can be traversed without contradiction.

1. Identity Format: verify structural validity for each canonical family.
2. Identity Uniqueness: reject duplicates in authoritative datasets.
3. World Resolution: resolve canonical intent for cross-entity references.
4. World Integrity: enforce coherence constraints beyond pure reference existence.
5. Canonical Adoption: report migration progress by entity type.
6. Legacy Compatibility: fail when presentation-style IDs appear in canonical fields.

## Error Message Standard

Validator output must explain and guide, not only reject.

Preferred style:

- Name the failing entity and field.
- Show the invalid value.
- State the expected canonical form.
- Offer a likely correction when feasible.

Example:

`Book "Alice Mole's Grandparents Day Memory Walk" uses presentation identifier "SB008". Expected canonical identifier format: HH-[MODE]-NNNN (example HH-A-0008).`