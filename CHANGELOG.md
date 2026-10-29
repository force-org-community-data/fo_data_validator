# Changelog

## 1.4.0

- **Composition blocks that replace models.** A block may carry `replaces: { block, profile }`: each copy takes the place of models of that profile in another block instead of adding models ("one Thallax may be upgraded to a Praetorian for +10 points"). The unit's size and the target's cost are unchanged; only the profile counts move. New checks: the target block and profile exist, a replacing block isn't itself replaced, the models replaced never exceed what the target holds at its `min`, and `modelCount` accounts for them.
- **List rules in factions and sub-factions.** `listRules` is allowed in faction and sub-faction files, applying to contingents using that faction or a sub-faction the contingent took. A sub-faction replaces a parent's rule by listing it in `overrides` with `"kind": "listRules"`; a faction rule with the game's id is a warning, like other hidden records.
- **Group-scope expression rules.** An `expression` list rule may have `scope: "group"` and `groupTypes`: the condition is checked once for each group (of those types, if given) with the `group`, `contingent`, `root`, `main` and `list` scopes, and flags the list without preventing anything.
- **Slot options may have `units`**: a selector limiting the option to slots whose unit matches, seen before slot-option effects (a trait from an option or the detachment counts).
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using these needs validator ≥1.4.0 and an app that supports them.

## 1.3.0

- **Slots filled from another faction.** A slot may have a `source`: `{ faction, subFactions?: "any" | [ids] }`, a faction of the same game (possibly from another source) and optionally its sub-factions, whose units may fill the slot whether or not the contingent took them. The slot's `units` selector picks among them (its `unitIds` are the source's units) and sees only each unit's own traits; the detachment's `units` doesn't apply. Borrowed units keep their own records but not their home sub-faction's unit modifiers.
- **Slot `effects`**: stat, special-rule and trait effects on the unit in the slot, after the detachment's effects, e.g. replacing a borrowed unit's faction trait.
- `source`, `units` and `effects` are allowed on detachment slots and on slot options' `slot` effects.
- **Special rules may add slots**: `slots`, each `{ roleChoices, units?, source?, effects? }`, added to the group once per unit with the rule.
- **Selector `exclude`**: units matching any entry (`unitIds`, `roles`, `traits`, `profiles`) don't match, e.g. `{ "exclude": [{ "profiles": { "anyOf": ["Unique"] } }] }` for "no Unique models".
- New checks: unknown source factions and sub-factions, `unitIds` not among the source's units, a slot a mechanic adds with no role.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using these needs validator ≥1.3.0 and an app that supports them.

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
