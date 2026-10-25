# Changelog

## 1.2.0

- **Composition blocks.** A unit may list `composition`: blocks of models bought together, `{ id, name?, description?, profiles: { profileId: count }, min? (default 1), max? (default min), cost? }`. They give the number of models of each profile and how the unit grows, including multi-model increments (a Gun Crew of a Gunner and a Loader at +35 per crew) and extra models of one profile only. `modelCount` stays required and must match the blocks at their `min`; `additionalModels` isn't allowed alongside. `perModel` default wargear with a `profileId` now means one per model of that profile.
- **Trait effects.** `{ "kind": "trait", "add"?, "remove"?, "replace"?: { "from", "to" }, "when"? }`, allowed in option effects, slot-option effects, unit-modifier actions and the new detachment `effects`.
- **Detachment `effects`**: stat, special-rule and trait effects applied to every unit in the detachment ("Every unit in this detachment gains the Gun Line trait").
- **Traits are matchable**: a `trait:` reference (`unit.is(trait:x)`, `profile.is(trait:x)`, `count`/`has` on groups, contingents and the list), and `traits` on unit selectors. Unknown traits are warnings. `ExpressionVocabulary.traits` (optional) lists the known traits.
- **`main` scope**: the list's main contingent (root group type with `source: main`), with `contingent`'s verbs, available wherever `list` is. E.g. a sub-faction `when` of `not main.is(faction:field-army) or main.is(subfaction:veterans)`.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using these needs validator ≥1.2.0 and an app that supports them.

## 1.1.0

- **Sub-faction groups.** A faction may declare `subFactionGroups` (each with `min`, default 0, and `max`, default 1, as numbers or expressions in the `contingent` / `root` / `list` scopes), and a sub-faction may name its `group`, so a contingent can take several sub-factions of one faction: one per group, or up to the group's `max`. Sub-factions without a `group` are in the `default` group (max 1), so existing data validates unchanged.
- A sub-faction may have a `when` condition for when it may be taken (`contingent`, `root`, `list` scopes).
- New check: sub-factions that can be taken together must not define the same record or unit modifier differently, or override the same parent record differently.
- `schemaVersion` stays 1; the additions are optional. Data using `group`, `when` on a sub-faction, or `subFactionGroups` needs validator ≥1.1.0 and an app that supports several sub-factions.

## 1.0.0

- First release.
