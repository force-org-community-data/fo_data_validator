# Data schema specification

Draft 1, 2026-10-17. Status: implemented (`src/game_data/schema.ts`, `readSource`, `validateGameData`). The army list model and remote source loading belong to the Force Org app and are specified in its repository.

- **Types:** the zod schemas in `src/game_data/schema.ts` are the source of truth. `src/types.ts` infers the TypeScript types from them, `checkShapes` (`src/game_data/shape.ts`) validates files against them in the browser and the CLI, and `npm run generate-schema` writes the JSON Schema for data authors' editors to `schema/`.
- **Examples:** `examples/`, three generic, game-neutral sources used as test fixtures (the snippets below are drawn from them):
    - `starter/`: the smallest valid source, one game and one faction;
    - `full/`: a game, faction and sub-faction that use every part of the schema;
    - `extension/`: an extension source adding a sub-faction to `full`'s game.
- **Expressions:** `expression_language_spec_2026-10-17.md`.
- **Reasoning and history:** `docs/multi_game_and_external_data_plan_2026-10-17.md` in the Force Org app repo, which also holds the army list model, the migration from the old types and the log of design decisions.

Every example source passes the shape check and the data checker (`npm run validate-data`).

## 1. Principles

1. **The validator ships no game data.** Everything below lives in public data sources (§2).
2. **Readable, permanent ids.** Record ids are slugs (`infantry-squad`), created from the name on first save and never changed after; every record's `id` equals its key. Ids are unique per kind within a faction (or game).
3. **The game defines its vocabulary.** Roles, unit types, group types, slot tags, resources, stat templates, list choices and the words players see all come from the game definition. Nothing game-specific is built in: tagged slots, root formations and contingent points are all configured data.
4. **Typed first, expressions as the escape hatch.** Recurring rule shapes have typed forms; expressions fill gaps (`when`, `min`, `max`, cost values).
5. **Every rule carries a player-facing message.** Expression conditions are `{ "if": …, "message": … }`; typed rules have a `message` or a generated one.

## 2. Data sources

A source is any public repo or static URL with a `forceorg.json` manifest at its root (`SourceManifest`). The app loads it through jsDelivr or raw.githubusercontent, by default at the latest release tag.

```json
{
    "schemaVersion": 1,
    "name": "Full coverage test source",
    "disclaimer": "Test data only.",
    "provides": [
        {
            "game": "game.json",
            "factions": ["factions/field-army.json"],
            "subFactions": ["sub-factions/veterans.json"]
        }
    ],
    "examples": ["lists/sample-list.json"]
}
```

- **`provides`** lists complete games: a `GameSystem` file plus its faction and sub-faction files.
- **`extends`** adds to a game defined elsewhere, by game id and version range (`examples/extension/forceorg.json`). The extension binds to a loaded source that provides that game; the user picks if several do.
- **`examples`** lists example lists the checker runs (§10).
- **`schemaVersion`** is this schema's version and **`expressionVersion`** the expression language's; consumers refuse sources newer than they understand (expression spec §14).

**Ids across sources.** Internally every record is keyed by source (`<source>::<id>`), so two sources may provide a faction with the same id. A faction resolves references within itself, then its game. The only cross-source references are a faction's game, a sub-faction's `parent`, which may be a faction from another source in the same game, and a slot's `source` (§7.1), which names a faction of the same game. Expressions never need source prefixes.

## 3. Game definition (`GameSystem`)

See `examples/full/game.json`.

### 3.1 Terms

The game's own words for built-in concepts, used in the UI and, via `word`, in expressions:

```json
"terms": {
    "group": { "word": "formation", "singular": "Formation", "plural": "Formations" },
    "root": { "word": "core", "singular": "Core Formation", "plural": "Core Formations" },
    "subFaction": { "singular": "Order", "plural": "Orders" }
}
```

A game could equally map `unit` to "squad" or `list` and `group` to "team". Keys are the built-in scopes plus `faction`, `subFaction`, `upgrade`, `wargear`, `weapon`, `equipment`, `specialRule` and `selector`.

### 3.2 Roles and unit types

Records: `{ "troop": { "id": "troop", "name": "Troops" } }`.

### 3.3 Group types and contingents

Each says how groups of that type form contingents:

```json
"core":    { "id": "core", "name": "Core", "contingent": "root", "source": "main", "min": 1, "max": 1 },
"allied":  { "id": "allied", "name": "Allied", "contingent": "root", "source": "ally" },
"reserve": { "id": "reserve", "name": "Reserve", "contingent": { "linksTo": ["core", "allied"] } }
```

- **Root** groups start a contingent; `source: "main"` uses the list's main faction and sub-faction, `"ally"` a different one the player picks.
- **Linked** groups attach to a root of one of the `linksTo` types and share its faction source.
- `min` / `max` limit how many a list may hold.
- A game may have a single root type and no linked types at all.

### 3.4 Slot tags

Game-declared tags for slots: `"slotTags": { "prime": { "id": "prime", "name": "Prime", "optionLabel": "Prime Option" } }`. A tag offers the slot options written for it (§3.8).

### 3.5 Resources

Costs are maps of resource to amount:

```json
"credits": { "id": "credits", "name": "Credits", "scope": "list", "defaultLimit": 50, "suffix": "cr" },
"slots":   { "id": "slots", "name": "Slots", "scope": "unit", "capacityStat": "capacity" }
```

- `list` resources are spent across the list against the player's limit (points, credits).
- `unit` resources are spent within one unit against a capacity read from its profile stat. Equipment slots need no special mechanic.
- `contingent` resources are granted and spent within each contingent and never set by the player: reserve and elite points (§3.8).
- Costs everywhere are maps: `"cost": { "credits": 2, "slots": 1 }`.

### 3.6 Stat templates

The game declares unit and weapon templates; each profile names its template and its `stats` must have exactly the template's keys:

```json
"vehicle": {
    "id": "vehicle",
    "name": "Vehicle",
    "stats": [
        { "id": "hull", "label": "Hull", "numeric": true },
        { "id": "armour", "label": "Armour", "numeric": true }
    ]
}
```

`numeric` stats can be shifted by stat effects ('3+' -1 → '2+').

### 3.7 List choices and list rules

```json
"choices": {
    "stance": {
        "id": "stance",
        "name": "Stance",
        "values": { "offensive": { "id": "offensive", "name": "Offensive" }, "defensive": { "id": "defensive", "name": "Defensive" } },
        "default": "offensive"
    }
},
"listRules": {
    "allies-cap": {
        "kind": "resourceCap",
        "id": "allies-cap",
        "resource": "points",
        "contingentTypes": ["allied"],
        "max": { "percentOfLimit": 50, "round": "up" },
        "message": "No more than 50% of the points limit may be spent on allied units"
    }
}
```

- **Choices** are list-wide options (stance, battle size, game mode), read in expressions with `choice(stance) == defensive`.
- **List rules** are typed:
    - `resourceCap`: percentage or absolute caps, e.g. heavy units 25%, allies 50%;
    - `count`: min/max matching units or groups per group, contingent or list; `max` may be an expression;
    - `expression`: escape hatch, a condition with a message.

### 3.8 Slot options and contingent resources

Behaviour that once needed a TypeScript "mechanic" is plain data built from two general pieces, so the engine holds no game's rules and the Data Editor edits them like any record.

**Slot options** (`slotOptions` records in the game, factions and sub-factions) are choices a slot with a tag offers, one per tag, e.g. special benefits or enhancements. Each names its `slotTag`, may limit itself to slots of some roles (`slotRoles`), may cost something (`cost`, added to the unit in the slot) and has `effects`: stat changes and special rules on the unit's profiles, an extra slot in the group (`slot`, with role choices and optionally `units`, a `source` and `effects`, §7.1), or other roles allowed into the slot (`allowedRoles`). The tag's `optionLabel` names them in the UI ("Prime Option"). A list slot records the picks as `slotOptions: { [tag]: { option, role? } }`.

**Contingent resources** (`scope: "contingent"`, §3.5) are granted and spent within each contingent:

```json
"roles":      { "commander": { "id": "commander", "name": "Commander", "grants": { "reserve": 1, "elite": 1 } } },
"groupTypes": { "elite": { "id": "elite", "name": "Elite", "contingent": { "linksTo": ["core", "allied"] }, "cost": { "reserve": 1, "elite": 1 } } },
"resources":  { "reserve": { "id": "reserve", "name": "Reserve Points", "scope": "contingent", "message": "Too many Reserve and Elite Formations" } }
```

- A filled slot grants what its first granting role `grants`.
- A unit grants what its special rules `grant` (once per rule, rules a slot option gives it included). Amounts may be expressions with the `rule` scope: Quartermaster (X) is `{ "reserve": "rule.value() - 1" }` with `defaultValue: "2"`.
- Each group spends its `cost` (the detachment's own, or its group type's). A group's cost in list resources (points) counts in the list's totals too.
- A contingent below zero in a resource gets the resource's `message`.

### 3.9 Shared records

The game may also hold `detachments` every faction can take (formations shared by every faction), universal `specialRules`, `selectors`, `slotOptions` and `subChoices`. Factions see their own records first, then the game's.

## 4. Factions and sub-factions

```json
{
    "id": "field-army",
    "version": "1.0.0",
    "name": "Field Army",
    "game": { "id": "full-game", "versions": ">=1.0.0 <2.0.0" },
    "units": { … }, "weapons": { … }, "equipment": { … }, "upgrades": { … },
    "specialRules": { … }, "detachments": { … }, "selectors": { … }
}
```

A faction may name a **`defaultDetachment`**: the detachment (its own or the game's, of a root group type taken from the main faction) a new list starts with when the faction is picked, e.g. a standard core formation. The player can still pick another.

A **sub-faction** (`SubFaction`) is a modifier of its parent:

- `parent: { faction, versions? }` may name a faction from another source in the same game (`examples/extension/sub-factions/irregulars.json`).
- **`overrides`** lists records that intentionally replace the parent's (same kind and id). Any other id collision with the parent is an error, so accidental overrides can't happen.
- **Unit modifiers** pick units with a selector and apply actions (`addUpgrade`, stat, special-rule and trait effects (§5.2), or **`unavailable`**: matched units can't be taken, with a message). This is how a sub-faction bans units:

    ```json
    "no-walkers": {
        "id": "no-walkers",
        "name": "No Walkers",
        "selector": { "unitIds": ["walker"] },
        "actions": [{ "kind": "unavailable", "message": "Veterans may never take Walkers" }]
    }
    ```

- Stat and special-rule effects may carry a `when` condition (`examples/full/sub-factions/veterans.json`).

### 4.1 Sub-faction groups

A contingent may take **several sub-factions of its faction**: one pick per independent choice the rules offer (a doctrine *and* a heritage). The faction declares those choices as **`subFactionGroups`**, and each sub-faction names its group in **`group`**:

```json
"subFactionGroups": {
    "doctrine": { "id": "doctrine", "name": "Doctrine", "max": 1 },
    "heritage": { "id": "heritage", "name": "Heritage", "max": "1 + (list.has(unit:walker) ? 1 : 0)" }
}
```

- A group's **`min`** (default 0) and **`max`** (default 1) are how many of its sub-factions a contingent must / may take. They're numbers or expressions in the `contingent`, `root`, `main` and `list` scopes, evaluated for the contingent taking them.
- **The `default` group.** A sub-faction without `group` is in the group `default`, which has `max: 1` unless declared: one sub-faction per faction, as before groups existed. A faction may declare `default` in `subFactionGroups` to name it or change its limits (`"min": 1` to require a pick); `"group": "default"` means the same as leaving `group` out. Any other `group` must be declared by the parent; an unknown one is an error.
- A sub-faction's **`when`** (a condition) says when it may be taken: `choice(allegiance) == traitor`, or `list.has(subfaction:…)` for one that needs another pick. Its expression sees `contingent`, `root`, `main` and `list` for the contingent it is taken for. The app re-checks it whenever the list changes; a sub-faction whose `when` stops holding is a list issue, not removed.
- **Following the main contingent** (validator 1.2.0). `main` is the list's main contingent, the one whose root group's type has `source: main`. An allied contingent's pick can depend on it: `not main.is(faction:field-army) or main.is(subfaction:veterans)` (a sub-faction that may only serve alongside a Veterans army). For the main contingent's own picks, `main` is that contingent. The main contingent's picks are usually made first, but nothing depends on the order: every `when` is re-checked live, so changing the main pick turns an ally's pick that no longer fits into a list issue.
- **`subfaction:` references** (`contingent.is(subfaction:x)`, `list.is(subfaction:x)`) are true when `x` is any of the sub-factions taken.
- **Combining sub-factions.** Sub-factions that can be taken together are merged into the parent in one go: two in different groups, or two in one group whose `max` is an expression or more than 1. Such sub-factions must not define a record (same kind and id) or a unit modifier (same id) **differently**; identical copies are fine and are merged as one. Two of them overriding the same parent record is the same error unless their replacements are identical: there is no "last group wins". Sub-factions that can't be taken together (two in a group of at most one) may reuse ids freely. Each sub-faction is still checked against its parent alone, and collisions with the parent's records stay governed by `overrides`.
- **Saved lists** (the Force Org app, a separate repository). A contingent holds its picks as a list of sub-faction ids (`subFactions: string[]`, in the order picked) rather than one `subFaction`; the app checks each group's `min` / `max` and each pick's `when`, and merges the picks into the parent in group order (the order of `subFactionGroups`, `default` first). Data using `group` or `subFactionGroups` needs validator 1.1.0 or later and an app version that supports several sub-factions.

## 5. Units and profiles

```json
"squad": {
    "id": "squad",
    "name": "Infantry Squad",
    "role": "troop",
    "type": "infantry",
    "cost": { "points": 100 },
    "modelCount": 10,
    "additionalModels": { "max": 10, "cost": { "points": 10 } },
    "profiles": [
        { "id": "trooper", "name": "Trooper", "template": "infantry", "stats": { "move": "6", … } },
        { "id": "sergeant", "name": "Sergeant", "template": "infantry", "tags": ["Sergeant"], "stats": { … } }
    ],
    "defaultWargear": [
        { "kind": "weapon", "id": "rifle", "perModel": true, "excludeProfiles": { "anyOf": ["Sergeant"] } },
        { "kind": "weapon", "id": "rifle", "profileId": "sergeant" }
    ]
}
```

- `role` and `type` are game ids; `tags` (on units and profiles) are matched by `tag:` references and profile filters.
- Profiles always have an `id` and a `template`.
- `excludeProfiles` (a `ProfileFilter`) leaves profiles out of default wargear and per-model config. `perModel` with a `profileId` gives one to each model of that profile.
- **`traits`** are free text, matched case-insensitively by `trait:` references (expression spec §9) and selector `traits` (§8). Effects can change them (§5.2).
- **`when`** limits when the unit may be taken. **`limit`** caps how many a group, contingent or list may hold, with an optional expression (`militia` in `examples/extension`: "one, plus one per two Infantry Squads").

### 5.1 Composition blocks

`modelCount` and `additionalModels` give a unit's size, not which profile each model uses. A unit may instead list **composition blocks** (validator 1.2.0): sets of models bought together, each held between `min` and `max` times.

```json
"gun-team": {
    "cost": { "points": 40 },
    "modelCount": 2,
    "composition": [
        { "id": "gun-crew", "name": "Gun Crew", "profiles": { "gunner": 1, "loader": 1 },
          "min": 1, "max": 3, "cost": { "points": 35 } }
    ],
    "profiles": [ { "id": "gunner", … }, { "id": "loader", … } ],
    "defaultWargear": [
        { "kind": "weapon", "id": "cannon", "perModel": true, "profileId": "gunner" },
        { "kind": "weapon", "id": "rifle", "perModel": true, "profileId": "loader" }
    ]
}
```

A block is `{ id, name?, description?, profiles, min?, max?, cost? }`:

- `profiles`: profile id → models of it in **one copy** of the block (a whole number, at least 1).
- `min` (default 1): the copies the unit's `cost` buys. `max` (default `min`): the most copies allowed. `min: 0` makes a block optional.
- `cost`: what each copy above `min` costs, counted like additional-model costs (resource `usedFor: additionalModels`). Required when `max` > `min`.

Checks: block ids are unique; profile ids exist; a profile is in at most one block (a profile in none has no models, which is a warning); `min` ≤ `max`, both whole; `modelCount` (still required, so older readers see the base unit) equals Σ `min` × models per copy, and isn't 0; `additionalModels` isn't used alongside `composition`.

What the app derives from them:

- the live count of each profile: copies of its block × its number in the block;
- `unit.models()`: the sum of the live counts;
- the extra cost: Σ (copies − `min`) × the block's `cost`;
- `perModel` default wargear: one per model of each profile not excluded (only of `profileId`'s profile when given);
- per-model upgrades (`every`, `some`, `one-in-x`, `max`): counted from the live counts, of the upgrade's `profileId` profile when it has one.

A saved list's unit records `composition: { [blockId]: copies }` instead of `additionalModels`. Units without `composition` behave as before; their profile counts stay unknown.

### 5.2 Trait effects

```json
{ "kind": "trait", "add": ["Gun Line"] }
{ "kind": "trait", "replace": { "from": ["Disciplined", "Drilled"], "to": "Veteran Corps" }, "when": { … } }
```

A trait effect (validator 1.2.0) changes a unit's `traits`: `add` gives traits, `remove` takes them away if present, and `replace` takes away any of `from` and gives `to` only if one was there. Traits belong to the whole unit, so there is no profile filter and its `when` has no `profile` scope. It may appear wherever stat and special-rule effects do: option `effects`, slot-option `effects`, unit-modifier `actions` and detachment `effects` (§7). At least one of `add`, `remove` and `replace` is required; a trait both given and taken away is a warning.

**Order.** The app resolves a unit's traits in steps: the unit's own `traits`, then sub-faction unit modifiers, option effects, the detachment's effects, the slot's `effects` (§7.1), and slot-option effects. Each step's conditions see the traits from the steps before it. A detachment's and its slots' `units` selectors see the unit's traits before the detachment's and slot options' effects (a detachment can't admit units by the trait it gives them); a slot with a `source` sees only the unit's own `traits`. Everything else (`trait:` references in other expressions, list rules) sees the final traits.

## 6. Upgrades and options

A unit's upgrades hold options or references to faction upgrades, and may use `restrictions`, `replaces`, `limitBy`, `swaps` and `profileId`:

- `perModel` has a type (`single`, `multiple`, `every`, `some`, `one-in-x`) and may use `excludeProfiles`.
- **Shared option lists and clashes:** an upgrade can pull in a shared faction upgrade's options by reference (e.g. a universal "Officer Wargear" list). When an id appears more than once, the **upgrade's own option wins** over a shared one (a General's free Rifle, not the officer list's 5pt Rifle, which no player would take), and **between shared upgrades the one referenced first wins**, which the checker warns about since it's probably a mistake. The hidden options aren't offered; the Data Editor shows under each reference what it hides and why. Ids therefore stay plain (`rifle`), and editing a shared list can never break another unit's upgrade.
- Option and unit **costs are resource maps**.
- Upgrades may have `when`, `min`, `max`; options `when` and `max`.
- **Options may have `effects`**, stat or special-rule effects applied to the unit while picked (armour plating: +1 armour).
- **Sub-choices** are shared records (game or faction `subChoices`) that options list by id, so a weapon's mount is defined once:

    ```json
    // game.json
    "subChoices": {
        "mount": {
            "id": "mount",
            "name": "Mount",
            "default": "fixed",
            "values": {
                "fixed": { "id": "fixed", "name": "Fixed" },
                "turret": { "id": "turret", "name": "Turret", "costMultiplier": { "points": 2 } }
            }
        }
    }
    // faction option
    "mounted-cannon": { "id": "mounted-cannon", "name": "Mounted cannon", "cost": { "points": 20, "slots": 2 },
                        "weaponRefs": ["cannon"], "subChoices": ["mount"] }
    ```

    `costMultiplier` is per resource, so a turret can double points but leave slots alone. Expressions read the value with `option.choice(mount)`.

## 7. Groups (detachments, formations, teams)

```json
"armoured-spearhead": {
    "id": "armoured-spearhead",
    "name": "Armoured Spearhead",
    "type": "reserve",
    "slots": [{ "roles": ["transport"], "repeat": { "max": 3 } }],
    "max": "1 + floor(root.count(role:troop) / 2)",
    "requires": [{ "units": { "roles": ["troop"] }, "count": 2, "scope": "root" }],
    "requirementText": "Needs two Troop units in its Core Formation"
}
```

- `type` is a game group type.
- **Slots** have `roles` (one or more), optional `tags` (e.g. `prime`), `required` (compulsory slots), `units` (a `UnitSelector`), `when`, and **`repeat`**: the slot may be added more than once, each copy holding one unit. That covers a team of vehicles (`{ "min": 1 }`) and optional slots.
- `requires[].scope` is `contingent` (default) or `root`.
- Detachments may have `when`, `min` and `max`. `min` makes a detachment mandatory, e.g. a required veteran formation.
- **`effects`** (validator 1.2.0): stat, special-rule and trait effects applied to every unit in the detachment, including units in slots a slot option adds. "Every unit in this detachment gains the Gun Line trait" is `"effects": [{ "kind": "trait", "add": ["Gun Line"] }]`. Each effect may carry `profiles` (stat and special-rule effects) and `when`.

### 7.1 Slots filled from elsewhere

Validator 1.3.0. Some rules add a slot that units from another faction, or from other sub-factions of the contingent's faction, may fill: "this slot may hold any unit from another Legion", "this slot may hold one Battle Automata from the Machine Cult". Such a slot has a **`source`**:

```json
{
    "roleChoices": ["troop", "support", "heavy"],
    "source": { "faction": "field-army", "subFactions": "any" },
    "units": { "exclude": [{ "traits": ["Veterans"] }, { "profiles": { "anyOf": ["Unique"] } }] },
    "effects": [{ "kind": "trait", "replace": { "from": ["Field Army", "Disciplined"], "to": "Veterans" } }]
}
```

- **`source.faction`** is any faction of the game, possibly from another source, and may be the contingent's own. **`source.subFactions`** adds units of that faction's sub-factions, whether or not the contingent took them: `"any"` for every one loaded, or a list of ids. Left out, only the faction's own units are offered (not its sub-factions', and not the contingent's).
- **Picking units.** The slot's `units` selector picks among the source's units, so a rule written as "any unit except…" needs no list of ids and keeps working as units are added. Its `unitIds` are the source's units; named selectors (`"@name"`) are the slot owner's, as everywhere. The selector sees only each unit's own `traits`, before any unit modifier or effect. The detachment's own `units` doesn't apply to the slot. Use `exclude` (§8) for "not…" conditions.
- **The unit keeps its own records.** Its wargear, special rules, upgrades and composition are the ones its home faction (and home sub-faction) defines, already checked there. Its home sub-faction's unit modifiers don't come along; the contingent's sub-faction unit modifiers apply as to any unit of the contingent, and the slot may be filled even though the unit isn't of the contingent's faction.
- **`effects`** on the slot (stat, special-rule and trait effects) apply to the unit in it, after the detachment's `effects`, which apply too. A trait effect is how a rule like "its faction trait becomes Veterans" is written. Their special rules resolve where the slot is defined.
- **Where it can appear:** a detachment's `slots` (with `roles`), a slot option's `slot` effect, and a special rule's **`slots`**: slots each unit with the rule adds to its group, once per unit ("when a model with this rule is in a detachment, add a slot…"). A slot a mechanic adds has `roleChoices` (at least one), optional `units`, `source` and `effects`.

The checker reports an unknown `source` faction or sub-faction (a sub-faction must have the source faction as its parent), and `unitIds` that aren't among the source's units, and checks the slot's effects like any effect.

## 8. Selectors

```json
"selectors": {
    "line-troops": {
        "id": "line-troops",
        "name": "Line troops",
        "description": "Troop units with an Infantry profile",
        "match": { "roles": ["troop"], "profiles": { "anyOf": ["infantry"] } }
    }
}
```

Named `UnitSelector`s, referenced in expressions as `@line-troops`. They live in factions, sub-factions and the game.

**Typed selector fields accept them too:** detachment and slot `units`, `requires[].units`, unit modifier `selector`, and `units` on `resourceCap` / `count` list rules take either an inline `UnitSelector` or `"@name"`, so one definition serves expressions and typed rules:

```json
"requires": [{ "units": "@line-troops", "count": 2, "scope": "root" }]
```

A named selector's own `match` is always inline, so selectors can't refer to each other.

**`traits`** (validator 1.2.0) matches a unit with any of the listed traits, case-insensitively: `{ "traits": ["Field Army"] }`. A trait no unit has or is given is a warning. Profile filters don't match traits; use `when: unit.is(trait:…)` on an effect instead.

**`exclude`** (validator 1.3.0) lists units to leave out: a unit matching any entry doesn't match the selector. Each entry takes `unitIds`, `roles`, `traits` and `profiles`, all of which must match, like a selector. `{ "exclude": [{ "traits": ["Veterans"] }, { "profiles": { "anyOf": ["Unique"] } }] }` is "not a Veterans unit, and no Unique model": unlike `profiles.noneOf`, which matches a unit with *some* profile outside the list, an excluded `profiles.anyOf` leaves out a unit with *any* matching profile.

## 9. Expressions in data

Expressions appear only in `when.if`, `min`, `max`, `limit.max`, `repeat.max` and cost values (see the expression spec §3). Examples from the example sources:

| Where | Expression |
| --- | --- |
| Heavy formation `when` | `list.limit(points) >= 1000` |
| Defensive-only option `when` | `choice(stance) == defensive` |
| Reserve formation `max` | `1 + floor(root.count(role:troop) / 2)` |
| Sub-faction stat effect `when` | `contingent.count(@line-troops) >= 3` |
| Extension unit `limit.max` | `1 + floor(contingent.count(unit:squad) / 2)` |
| Count rule `max` | `1 + floor(list.count(formation:core) / 2)` (using the game's words for `group`) |

## 10. Example lists and validation

A source may list example lists in its manifest's `examples`: a list plus `expect: "valid"` or the issues it must raise. The list format belongs to the Force Org app; the validator accepts the manifest field but doesn't read the files.

The checker validates:

- the schema;
- ids equal keys and every reference resolves (game vocabulary, templates and stat keys, wargear, upgrades, sub-choices, parents, overrides and slot sources);
- expressions (expression spec §12) and lint (§13);
- the example lists (by the app, not the validator).

Results:

- **Errors** keep that game or faction from loading and appear in a source report; **lint findings** are warnings.
- The same checker ships as a CLI (`fo-validate`) and a GitHub Action for data repos to run as CI checks, so nothing broken can merge.
