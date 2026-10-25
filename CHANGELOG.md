# Changelog

## 1.1.0

- **Sub-faction groups.** A faction may declare `subFactionGroups` (each with `min`, default 0, and `max`, default 1, as numbers or expressions in the `contingent` / `root` / `list` scopes), and a sub-faction may name its `group`, so a contingent can take several sub-factions of one faction: one per group, or up to the group's `max`. Sub-factions without a `group` are in the `default` group (max 1), so existing data validates unchanged.
- A sub-faction may have a `when` condition for when it may be taken (`contingent`, `root`, `list` scopes).
- New check: sub-factions that can be taken together must not define the same record or unit modifier differently, or override the same parent record differently.
- `schemaVersion` stays 1; the additions are optional. Data using `group`, `when` on a sub-faction, or `subFactionGroups` needs validator ≥1.1.0 and an app that supports several sub-factions.

## 1.0.0

- First release.
