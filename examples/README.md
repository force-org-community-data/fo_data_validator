# Example sources

Generic test sources. They reference no real game; they exist so every part of the data schema is exercised by the tests and by `npm run validate-data`.

- `starter/`: the smallest valid source (one game, one faction). Copy it to begin a new source.
- `full/`: uses every authorable schema field: terms, roles with grants, group types (root and linked), slot tags, list, unit and contingent resources, stat templates, list choices, every list rule kind, detachments (requirements, limits, costs, `when`), special rules (configurable, defaults, grants), named selectors, slot options (every effect kind), sub-choices, units with every upgrade form, a faction upgrade referenced by units, a sub-faction with overrides and every unit modifier action.
- `extension/`: an extension source that adds a sub-faction to `full`'s game (`fo-validate examples/full examples/extension`).

`full` lists a placeholder in the manifest's `examples` field; the checker accepts the field but doesn't read the files. `grantedBy` is set by the Force Org app, not by authors, so no fixture uses it.
