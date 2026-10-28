# Force Org data authoring guide

How to write Force Org game data as JSON files directly, by hand or with a coding agent, instead of using the Data Editor. Everything the list builder knows comes from these files; the app has no game rules in code.

Read this first, then use the pointers at the end for exact types, the full expression language and worked examples.

## 1. The loop

1. Copy `examples/starter/` (a complete, valid game with one faction) or the closest example source, and edit it.
2. Check it: `fo-validate <source folder>` (in this repository: `node bin/fo-validate.mjs <source folder>`)
3. Fix every `ERROR` and repeat until it reports `0 errors`. Add `--json` for machine-readable output.
4. Try it in the Force Org app by adding your source's address under Sources in its settings. A single faction file can also be imported through Data Editor → Factions → New Faction → Import from JSON, for the game that is open. The Data Editor downloads whatever it edits as these same files.

`fo-validate` runs two passes:

- **Shape** (against the JSON Schema in `schema/`, generated from the zod schemas in `src/game_data/schema.ts`): wrong types, misspelt keys, missing required fields, bad enum values. Errors are `file path: message`, where the path walks the JSON (`units/carrier/profiles`). If there are shape errors, the second pass is skipped.
- **Meaning** (`validateGameData`): every id equals its key, every reference resolves, stats match their templates, every expression parses and type-checks for its field. Expression errors print the expression with the bad part underlined and a "did you mean" hint where there is one.

Only edit what the errors point at. Don't hand-fix unrelated records.

**Working in your own data repo?** The validator lives in https://github.com/force-org-community-data/fo_data_validator. Add it as a dependency pinned to a release tag (`"@force-org/data-validator": "git+https://github.com/force-org-community-data/fo_data_validator.git#v1.0.0"`), run `npm install`, and check your folder with `npx fo-validate /path/to/my-data`. (For an extension source, pass the base source first: `npx fo-validate /path/to/base /path/to/my-data`.) To run the check on every push and pull request, use either the validator's GitHub Action or the `npx` workflow; both are in "Validate in CI" in its README.

## 2. Source layout

A **source** is a folder (or repo) with a `forceorg.json` manifest at its root:

```
my-data/
  forceorg.json
  game.json
  factions/warband.json
  sub-factions/veterans.json
```

```json
{
    "schemaVersion": 1,
    "expressionVersion": 1,
    "name": "My game data",
    "description": "optional",
    "disclaimer": "Unofficial. Not endorsed by <rights holder>.",
    "provides": [
        {
            "game": "game.json",
            "factions": ["factions/warband.json"],
            "subFactions": ["sub-factions/veterans.json"]
        }
    ]
}
```

- `provides` lists whole games: one `GameSystem` file plus its `Faction` and `SubFaction` files. Paths are relative to the manifest. A file that isn't listed isn't loaded.
- `extends` adds factions or sub-factions to a game another source provides, instead of `provides`: `{ "game": "full-game", "versions": ">=1.0.0 <2.0.0", "factions": [...], "subFactions": [...] }`. Validate with `fo-validate <base source> <extension source>`.
- `examples` (example lists) is accepted but not yet checked.
- `schemaVersion` is `1`: the version of the data format. `expressionVersion` is `1`: the version of the expression language your expressions are written for. Both only go up when a change would break existing data, and Force Org refuses a source whose version is newer than it understands (with a message to update the app). A missing `expressionVersion` is read as `1` with a warning, so always write it.

| File | Schema (in `schema/`) | Holds |
| --- | --- | --- |
| `forceorg.json` | `source-manifest.schema.json` | what the source provides |
| game file | `game.schema.json` | the game's vocabulary and the records every faction shares |
| faction file | `faction.schema.json` | one faction's units, wargear, upgrades, rules, detachments |
| sub-faction file | `sub-faction.schema.json` | a modifier of one faction |

## 3. Rules that apply everywhere

- **Ids are slugs** (`[a-z0-9]+(-[a-z0-9]+)*`, e.g. `infantry-squad`) and **every record's `id` equals the key it sits under**: `"carrier": { "id": "carrier", ... }`. Ids never change once published, because saved army lists point at them.
- **The game defines its vocabulary.** Roles, unit types, group types, slot tags, resources, stat templates and list choices are all declared in the game file; factions refer to them by id. Nothing is built in.
- **Costs are per resource**: `{ "points": 100 }`, or `{ "credits": 4, "slots": 1 }`. A value is a number or an expression string.
- **Typed rules before expressions.** Restrictions, `replaces`, `limitBy`, list rules and slot/group limits enforce themselves and fix picks. Use an expression only where no typed form fits (section 7).
- **Rules carry a player-facing `message`.** A condition is `{ "if": "<expression>", "message": "why" }`.
- **Stats are strings** (`"3+"`, `"6\""`), keyed by the stat ids of the profile's template, and every stat in the template must be present.
- **Individual models aren't tracked.** The list holds amounts of wargear, not which model carries what.
- Formatting: 4-space indent JSON; the app doesn't care, but keep diffs small.

## 4. The game file (`GameSystem`)

Required: `id`, `version`, `name`, `roles`, `unitTypes`, `groupTypes`, `resources`, `stats`.

| Key | Meaning |
| --- | --- |
| `terms` | the game's own words per concept (`group`, `root`, `contingent`, `list`, `unit`, `faction`, `subFaction`, `wargear`…): `{ "singular", "plural", "word"? }`. A `word` on a built-in scope (`"group": { "word": "detachment" }`) can be written in expressions in place of the built-in name. |
| `roles` | what fills a slot (Troops, Elites). `grants` gives the contingent resources when a slot of that role is filled. |
| `unitTypes` | Infantry, Vehicle… (matched by `type:` references and selectors). |
| `groupTypes` | kinds of container (detachment, team, formation). `contingent: "root"` starts a contingent (`source: "main"` or `"ally"`); `contingent: { "linksTo": ["core"] }` attaches to a root group. `min`/`max` limit how many; `cost` is what a group spends. |
| `slotTags` | tags a slot can carry (`prime`); slot options attach to a tag. `optionLabel` names the options. |
| `resources` | anything spent or capped. `scope: "list"` (points, set by the player: `defaultLimit`, `suffix`), `"unit"` (per-unit capacity from a profile stat: `capacityStat`), `"contingent"` (granted and spent within a contingent: `message` is the overspent issue). `usedFor` limits where an amount in it may be given (`unit`, `additionalModels`, `option`, `slotOption`, `group`, `grant`). |
| `stats` | `unit` and `weapon` stat templates: `{ "id", "name", "stats": [{ "id", "label", "numeric"? }] }`. A numeric stat can be shifted by effects (`3+` −1 → `2+`). |
| `choices` | list-level choices (stance, battle size): `{ "id", "name", "values": {...}, "default"? }`. Read in expressions with `choice(id)`. |
| `listRules` | typed list-wide rules (below). |
| `detachments` | groups every faction may take. |
| `specialRules`, `selectors`, `slotOptions`, `subChoices` | shared versions of the faction records of the same name. |

**List rules** (`listRules`, each with `kind` and `message`):

- `resourceCap`: `{ "kind": "resourceCap", "id", "resource": "points", "units"?: <selector>, "contingentTypes"?: [...], "max": { "percentOfLimit": 25, "round": "up" } | { "value": 500 }, "message" }`
- `count`: `{ "kind": "count", "id", "units"?: <selector>, "groupTypes"?: [...], "scope": "group" | "contingent" | "list", "min"?, "max"?, "message" }`
- `expression`: `{ "kind": "expression", "id", "when": { "if", "message" } }`

## 5. The faction file (`Faction`)

Required: `id`, `version`, `name`, `game: { "id", "versions" }` and all of `units`, `weapons`, `equipment`, `upgrades`, `specialRules`, `detachments` (use `{}` when empty). `defaultDetachment` is the root detachment a new list starts with; the checker requires a root detachment for a main faction.

### Units

```json
"infantry-squad": {
    "id": "infantry-squad",
    "name": "Infantry Squad",
    "role": "troop",
    "type": "infantry",
    "tags": ["Line"],
    "cost": { "points": 100 },
    "modelCount": 10,
    "additionalModels": { "max": 10, "cost": { "points": 10 } },
    "profiles": [
        { "id": "trooper", "name": "Trooper", "template": "infantry",
          "stats": { "m": "7", "ws": "4" } },
        { "id": "sergeant", "name": "Sergeant", "template": "infantry",
          "tags": ["Sergeant"], "stats": { "m": "7", "ws": "4" } }
    ],
    "defaultWargear": [{ "kind": "weapon", "id": "rifle", "perModel": true,
                         "excludeProfiles": { "anyOf": ["sergeant"] } }],
    "upgrades": { },
    "limit": { "max": 1, "scope": "list", "message": "Unique" },
    "when": { "if": "…", "message": "…" }
}
```

- `role`, `type` and profile `template` are ids from the game. `tags` are free text, matched case-insensitively (`tag:heavy-assault` for `Heavy Assault`).
- `traits` are the unit's traits (a faction trait, "Gun Line"): free text, matched case-insensitively by `trait:` references and selector `traits`. Effects can add, remove or replace them (see Effects).
- `profiles[].id` is what upgrades, default wargear and sub-faction rules point at (`profileId`).
- `defaultWargear` is carried without any upgrade; `perModel` makes the amount follow the model count; `excludeProfiles` leaves out one model per matching profile. With `perModel` and `profileId`, each model of that profile carries one.
- `limit` caps how many of the unit a `group`, `contingent` or the `list` may hold (a number or expression).

### Composition: how many models of each profile

`modelCount` and `additionalModels` say how big a unit is, but not which profile each model uses. When that matters (a Sergeant and 9 Troopers, extra models that are always Troopers, a crew of two different models bought together), describe the unit as **composition blocks**. A block is a set of models bought together; the unit holds between `min` and `max` copies of it:

```json
"gun-team": {
    "cost": { "points": 40 },
    "modelCount": 2,
    "composition": [
        { "id": "gun-crew", "name": "Gun Crew",
          "profiles": { "gunner": 1, "loader": 1 },
          "min": 1, "max": 3, "cost": { "points": 35 } }
    ],
    "profiles": [ { "id": "gunner", … }, { "id": "loader", … } ]
}
"infantry-squad": {
    "modelCount": 10,
    "composition": [
        { "id": "sergeant", "profiles": { "sergeant": 1 } },
        { "id": "troopers", "name": "Troopers", "profiles": { "trooper": 1 },
          "min": 9, "max": 19, "cost": { "points": 10 } }
    ]
}
```

- `profiles` gives the models of each profile in **one copy** of the block (whole numbers, at least 1). A profile is in at most one block; one in no block has no models (a warning).
- `min` (default 1) is the number of copies the unit's `cost` buys, and `max` (default `min`) is the most it may hold. A block whose `max` is above `min` needs a `cost` for each extra copy. `min: 0` makes a block optional.
- `modelCount` is still required and must equal the blocks at their `min` (Σ `min` × models per copy), so older apps still read the unit. Don't use `additionalModels` alongside `composition`.
- The app counts each profile's models from the copies taken, which drives `unit.models()`, `perModel` default wargear, and per-model upgrades. A `perModel` upgrade with a `profileId` counts only that profile's models, so "each Loader may exchange…" is `"profileId": "loader", "perModel": { "type": "some" }`.
- Needs validator 1.2.0+ and an app that supports composition blocks.

### Weapons, equipment, special rules

- `weapons`: `{ id, name, template, profiles: [{ name, stats, traits?, specialRules? }] }`, `template` a weapon stat template of the game.
- `equipment`: `{ id, name, text }`.
- `specialRules`: `{ id, name, text, configurable?, defaultValue?, grants?, slots? }`. Units and profiles use them as `{ "id", "value"? }` in `specialRules`. `grants` gives contingent resources and may use `rule.value()`. `slots` are slots each unit with the rule adds to its group (see [Slots filled from another faction](#slots-filled-from-another-faction)).

### Upgrades and options

A unit's `upgrades` is a record of `Upgrade`s; each holds `options`.

```json
"squad-options": {
    "id": "squad-options",
    "name": "Squad options",
    "perModel": { "type": "single" },
    "default": "rifle",
    "options": {
        "rifle":  { "id": "rifle", "name": "Rifle", "cost": { "points": 0 }, "weaponRefs": ["rifle"] },
        "plasma":  { "id": "plasma", "name": "Plasma gun", "cost": { "points": 15 }, "weaponRefs": ["plasma-gun"],
                     "when": { "if": "choice(stance) == defensive", "message": "Defensive forces only" } },
        "shared":  { "id": "shared", "target": "sergeant-melee" }
    }
}
```

- `perModel.type`: `single` (once), `multiple` (any number of times), `every` (every model), `some` (any number of models), `one-in-x` (one per `everyX` models). `max` and `excludeProfiles` refine it.
- An option gives wargear through `weaponRefs` / `equipmentRefs` (faction weapon/equipment ids). It may also have `swaps`, `subChoices`, `effects`, `when`, `max`.
- `{ "id", "target" }` is an **UpgradeReference** to a faction-level upgrade in the faction's `upgrades`, so a shared wargear list is written once. When option ids clash, the upgrade's own option wins, then the first-referenced shared upgrade.
- **Restrictions** (`restrictions: { "exclusions": [...], "required": [...], "requiredAnd": false }`) and `limitBy` point at wargear (`{ "kind": "weapon" | "equipment", "id" }`), not at options, so a rifle satisfies a requirement whichever slot it came from. Write an exclusion on one side only; it applies both ways.
- `replaces`: sibling upgrades that a non-default pick takes the place of. `limitBy`: caps non-default picks at Σ `count` × the wargear held (zero held blocks it).
- `profileId` puts the upgrade's wargear on that profile (for example the sergeant); left out, it belongs to the unit at large. `swaps: [{ "from": <wargear ref>, "to": <wargear ref> }]` replaces wargear that profile holds.
- `subChoices` on an option lists ids of `SubChoice`s (defined once in the game or faction): a picker beside the option whose value may add to (`cost`) or multiply (`costMultiplier`) the option's cost.

### Effects

Stat and special-rule changes on profiles chosen by a **ProfileFilter** `{ "anyOf": [...], "noneOf": [...] }` (matched on profile type and tags, the unit's included):

```json
{ "kind": "stat", "profiles": { "anyOf": ["infantry"] },
  "changes": [{ "stat": "ws", "op": "add", "value": -1 }, { "stat": "m", "op": "set", "value": "8\"" }],
  "when": { "if": "…", "message": "…" } }
{ "kind": "specialRule", "rule": { "id": "fear", "value": "2" } }
```

A **trait effect** changes the unit's traits. Traits belong to the whole unit, so it has no profile filter, and its `when` can't use `profile`:

```json
{ "kind": "trait", "add": ["Gun Line"] }
{ "kind": "trait", "remove": ["Line"] }
{ "kind": "trait", "replace": { "from": ["Disciplined", "Drilled"], "to": "Veteran Corps" } }
```

`replace` removes any of `from` and adds `to` only if the unit had one of them ("models replace their X trait with Y").

Effects appear on `Option.effects`, slot options, sub-faction unit modifiers and detachments (`effects`). `when` on an effect holds it back until true. The app applies them in this order: the unit's own traits, sub-faction unit modifiers, options, the detachment, the slot's own `effects`, slot options. Each step's `when` sees the result of the earlier steps.

### Detachments (groups)

```json
"patrol": {
    "id": "patrol",
    "name": "Patrol",
    "type": "core",
    "slots": [
        { "roles": ["command"], "required": true },
        { "roles": ["troop"], "repeat": { "min": 1, "max": 6 } },
        { "roles": ["heavy", "support"], "tags": ["prime"] }
    ],
    "units": "@line-troops",
    "requires": [{ "units": { "unitIds": ["infantry-squad"] }, "count": 1, "scope": "root" }],
    "requirementText": "Needs an Infantry Squad in its core formation",
    "when": { "if": "list.limit(points) >= 3000", "message": "3000 points or more" },
    "min": 0, "max": "1 + floor(root.count(role:troop) / 2)",
    "cost": { "reserve": 1 }
}
```

- `type` is a group type of the game. A slot is filled by a unit whose role is in `roles`; `tags` mark it for slot options; `repeat` lets the slot be added more than once; `units` (on the detachment or a slot) restricts which units may fill it, using a selector.
- `requires` lists units the contingent (or its root group) must already hold; `when`, `min`, `max` and `cost` as above. Unavailable detachments are disabled in the builder's menus and never removed automatically.
- `effects` (stat, special-rule and trait effects) apply to every unit in the detachment, including slots added later, for rules such as "Every unit in this detachment gains the Gun Line trait": `"effects": [{ "kind": "trait", "add": ["Gun Line"] }]`. The detachment's and slots' `units` selectors see a unit's traits **before** the detachment's own effects, so a detachment can't let units in by the trait it gives them. Needs validator 1.2.0+.

### Slots filled from another faction

Some rules add a slot that another faction's units, or units of other sub-factions of your faction, may fill. Give the slot a `source`, pick units with `units`, and change them with the slot's `effects`. Needs validator 1.3.0+.

"Add a slot of any role but Commander, filled by a unit from another order of this army, but not a Veterans unit or one with a Unique model; its Field Army trait becomes Veterans" (a slot option's `slot` effect):

```json
{ "kind": "slot", "roleChoices": ["troop", "support", "heavy"],
  "source": { "faction": "field-army", "subFactions": "any" },
  "units": { "exclude": [{ "traits": ["Veterans"] }, { "profiles": { "anyOf": ["Unique"] } }] },
  "effects": [{ "kind": "trait", "replace": { "from": ["Field Army"], "to": "Veterans" } }] }
```

"When a model with this rule is in a detachment, add a Heavy slot for one Battle Automata from the Machine Cult" (a special rule's `slots`):

```json
"automata-handler": { "id": "automata-handler", "name": "Automata Handler", "text": "…",
  "slots": [{ "roleChoices": ["heavy"], "source": { "faction": "machine-cult" },
              "units": { "unitIds": ["battle-automata"] } }] }
```

- `source.faction` is any faction of the game, even one from another source. `subFactions` adds its sub-factions' units: `"any"` or a list of ids. Without it only the faction's own units are offered.
- Prefer a selector that describes the rule (`exclude`, `roles`, `traits`) over a list of `unitIds`: new units then qualify without anyone editing your file. `unitIds` in a sourced slot name the source's units.
- The selector sees only the unit's own `traits`. The detachment's `units` doesn't apply to the slot; its `effects` do, then the slot's.
- The unit keeps its own wargear, rules and upgrades. Its home sub-faction's unit modifiers don't come with it.
- Detachment `slots` take a `source` too (with `roles`, as usual).

### Selectors

A **UnitSelector** picks units: `{ "unitIds": [...], "roles": [...], "traits": [...], "profiles": { "anyOf": [...], "noneOf": [...] }, "exclude": [...] }` (omitted field matches all; `traits` matches a unit with any of them, case-insensitively). `exclude` lists units to leave out, each entry matched like a selector: `{ "exclude": [{ "profiles": { "anyOf": ["Unique"] } }] }` leaves out any unit with a Unique profile, which `profiles.noneOf` can't say (it matches a unit with *some* profile that isn't Unique). Needs validator 1.3.0+. Profile filters don't look at traits; on an effect use `when: unit.is(trait:…)`. Anywhere one is accepted, `"@name"` refers to a **NamedSelector** in `selectors` (`{ "id", "name", "match": <UnitSelector> }`), looked up in the faction (with its sub-faction), then the game.

### Slot options (benefits for tagged slots)

`slotOptions`: `{ "id", "name", "text", "slotTag", "slotRoles"?, "cost"?, "effects"? }`. A slot with the tag offers one option; effects are stat/special-rule effects, plus at most one `{ "kind": "slot", "roleChoices": [...] }` (an extra slot, which may take `units`, a `source` and `effects`) and one `{ "kind": "allowedRoles", "roles": [...] }`.

## 6. The sub-faction file (`SubFaction`)

A modifier of a faction (an order, a regiment, a sponsor):

```json
{
    "id": "veterans",
    "version": "1.0.0",
    "name": "Veterans",
    "parent": { "faction": "field-army", "versions": ">=1.0.0 <2.0.0" },
    "overrides": [{ "kind": "specialRules", "id": "field-army" }],
    "specialRules": { },
    "upgrades": { },
    "unitModifiers": {
        "flamers-for-all": {
            "id": "flamers-for-all",
            "name": "Flamers for all",
            "selector": "@line-troops",
            "actions": [
                { "kind": "addUpgrade", "upgradeId": "veterans-flamer" },
                { "kind": "stat", "changes": [{ "stat": "t", "op": "add", "value": 1 }] },
                { "kind": "unavailable", "message": "Not available to this order" }
            ]
        }
    }
}
```

- It may hold the same record kinds as a faction (`units`, `weapons`, `upgrades`, `specialRules`, `detachments`, …); they merge over the parent's. A record that shares a kind and id with the parent's **replaces** it only if listed in `overrides`; any other collision is an error.
- `unitModifiers` pick units with a selector and add a copy of a faction upgrade (`addUpgrade`, stable id from the modifier), apply stat/special-rule effects, or make the units `unavailable`.

### Several picks per faction (sub-faction groups)

When the rules let an army make more than one independent pick (a doctrine **and** a heritage, or one heritage plus a second under a condition), declare each pick as a group on the **faction** and put each sub-faction in one:

```json
// factions/field-army.json
"subFactionGroups": {
    "doctrine": { "id": "doctrine", "name": "Doctrine", "max": 1 },
    "heritage": {
        "id": "heritage",
        "name": "Heritage",
        "max": "1 + (list.has(unit:walker) ? 1 : 0)"
    }
}

// sub-factions/coastal-heritage.json
"group": "heritage",
"when": { "if": "choice(stance) == defensive", "message": "Coastal heritage is only for defensive lists" }
```

- `min` defaults to 0 and `max` to 1. Both may be expressions over `contingent`, `root`, `main` and `list`.
- Leave `group` out and the sub-faction is in the `default` group (at most one): a faction with a single pick (one regiment) needs no groups at all. Declare `default` in `subFactionGroups` if you want to name it or set `"min": 1`.
- `when` restricts a sub-faction: Traitor-only (`choice(allegiance) == traitor`), or needing another pick (`list.is(subfaction:…)`). Same scopes as the group limits.
- **Following the main contingent.** `main` is the list's main contingent (the one whose root group has `source: main`, e.g. the core formation and the formations linked to it). An allied contingent's sub-faction can follow it: a sub-faction that may only serve alongside a Veterans army is `"when": { "if": "not main.is(faction:field-army) or main.is(subfaction:veterans)", "message": "…" }`. When the sub-faction's own contingent is the main one, `main` is that contingent. Needs validator 1.2.0+.
- Sub-factions that can be taken together (different groups, or a group allowing more than one) must not define the same record or unit modifier id **differently**. Share a rule by copying it identically, or rename one. Two of them overriding the same parent record differently is an error too. Sub-factions in a group of at most one can't meet, so they may reuse ids.
- Needs validator 1.1.0+ and an app that supports several sub-factions per contingent.

Examples: `examples/full/sub-factions/*-doctrine.json` and `*-heritage.json`.

## 7. Expressions

Where no typed rule fits, a string expression computes a number or a condition. They read the list, never change it, always finish, and are checked when the data loads (`fo-validate` reports them).

```
1 + floor(root.count(role:troop) / 2)            a number: max of a detachment
choice(stance) == defensive                     a condition: when of an option
list.limit(points) >= 3000                        a condition: when of a detachment
unit.has(weapon:lascannon) ? 25 : 15              a number: cost of an option
```

**Where:** `when.if` (bool); `min`/`max` on upgrades, options, detachments, group types, count rules, unit `limit.max`, slot `repeat.max` (number); cost values and resource `grants` (number).

**Syntax:** numbers; `+ - * /`; `== != < <= > >=` (not chainable); `and or not true false`; `a ? b : c` (spaces around the colon); `( )`. Names are lowercase with single hyphens inside, so write `a - b` with spaces for subtraction. No variables, strings, loops or property access.

**Scopes** (`scope.function(args)`), each seeing its own subject and what contains it. Which scopes a field may use:

| Field | Scopes |
| --- | --- |
| detachment `when` | `contingent`, `root`, `main`, `list` |
| detachment `min`/`max` | `group`, `contingent`, `root`, `main`, `list` |
| slot `when`/`repeat.max`, slot options | `slot`, `group`, `contingent`, `root`, `main`, `list` |
| unit `when`/`limit.max`/cost | `unit`, `slot`, `group`, `contingent`, `root`, `main`, `list` |
| upgrade `when`/`min`/`max` | the unit's, plus `profile` when the upgrade has a `profileId` |
| option `when`/`max`/cost, sub-choice values | `option`, plus an upgrade's |
| stat / special-rule effect `when` | `profile`, `unit`, `slot`, `group`, `contingent`, `root`, `main`, `list` (trait effects: the same without `profile`) |
| special rule `grants` | `rule`, `unit`, `slot`, `group`, `contingent`, `root`, `main`, `list` |
| sub-faction `when`, sub-faction group `min`/`max` | `contingent`, `root`, `main`, `list` |
| group type `min`/`max`, list rules | `main`, `list` (count rules limited to a contingent or group also see those and `root`) |

`main` is the list's main contingent: the one whose root group's type has `source: main`.

**Functions per scope:**

| Scope | Functions |
| --- | --- |
| `rule` | `value()` |
| `option` | `picks()`, `choice(sub-choice)` |
| `profile` | `count(wargear)`, `has(wargear)`, `is(type:, tag: or trait:)` |
| `unit` | `count(wargear)`, `has(wargear)`, `is(unit:/role:/type:/tag:/trait:/@sel)`, `sum(resource)`, `limit(unit resource)`, `models()` |
| `slot` | `is(tag: or role:)` |
| `group`, `root` | `count(unit ref or wargear)`, `has(...)`, `is(type: or group:)`, `sum(resource[, unit ref])` |
| `contingent`, `main` | `count(unit ref, wargear or group:)`, `has(...)`, `is(faction: or subfaction:)`, `sum(resource[, unit ref])` |
| `list` | as `contingent`, plus `limit(list resource)` |

Global: `choice(name)` (a list choice; compare with its value bare: `choice(stance) == defensive`), `floor(x)`, `ceil(x)`, `min(a, b, …)`, `max(a, b, …)`.

**References** are arguments only, `kind:id` with no spaces: `unit:`, `role:`, `type:` (a unit type, or a group type on `group`/`root`), `tag:` (lowercase-hyphen form of a free-text tag; a slot tag on `slot`), `trait:` (lowercase-hyphen form of a unit trait, including traits effects give; an unknown one is a warning), `weapon:`, `equipment:`, `group:` (a group type or detachment; the game's word works too), `faction:`, `subfaction:`; and `@id` for a named selector. `unit.count(role:troop)` is not allowed (on a unit `count`/`has` only count wargear; use `unit.is(role:troop)`).

**Evaluation:** live as the list changes; a candidate is evaluated as if placed; a false `when` disables what isn't picked and raises an alert for what is; non-integer `min`/`max` round down; costs must be ≥ 0; errors (division by zero, negative cost) count the rule as not met instead of crashing.

The complete reference is `docs/specs/expression_language_spec_2026-10-17.md`; the Force Org app's Data Editor → Docs page shows it with the open game's names listed live.

## 8. Common mistakes

- `id` doesn't equal its key, or a key is not a slug (capitals, spaces, underscores).
- A role, unit type, template, group type, resource or choice used in a faction but never declared in the game file.
- A profile missing a stat its template lists, or carrying one it doesn't.
- Options pointing at weapons or equipment that aren't in the faction (`weaponRefs` are weapon ids).
- Restrictions written against option ids; they take wargear (`{ "kind", "id" }`).
- `upgrades`, `weapons`, `equipment`, `specialRules` or `detachments` left out of a faction instead of `{}`.
- A sub-faction record with the same kind and id as the parent's but no `overrides` entry.
- An expression using a scope the field can't see, a verb the scope doesn't have, or `a-b` for subtraction.
- Writing a rule as an expression when a typed form exists. The checker warns ("use `restrictions.exclusions`", "use a `resourceCap` list rule", …); do as it says.
- No `defaultDetachment` on a main faction, or one that isn't a root group of the game.

## 9. Where to look next

- `schema/*.schema.json`: the exact schema of each file kind with a description on every field. Point your editor at them for completion and inline errors: add `"$schema": "<url or relative path>/faction.schema.json"` to a file (Force Org ignores the key), or map them in your editor settings. They are generated from `src/game_data/schema.ts` with `npm run generate-schema`.
- `docs/specs/data_schema_spec_2026-10-17.md`: the reasoning behind the schema. The spec was written before implementation; where it differs from the JSON Schema or the validator, those win.
- `docs/specs/expression_language_spec_2026-10-17.md`: the full expression language.
- `examples/`: complete sources. generic, game-neutral test sources. `starter` (smallest), `full` (uses every part of the schema: contingent and unit resources, slot options, list rules, sub-choices, sub-faction modifiers), `extension` (an extension source for `full`).
- The Force Org app's Data Editor → Docs page: the same material as a page, with the open game's names listed live.
