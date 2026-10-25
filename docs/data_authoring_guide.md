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
- `profiles[].id` is what upgrades, default wargear and sub-faction rules point at (`profileId`).
- `defaultWargear` is carried without any upgrade; `perModel` makes the amount follow the model count; `excludeProfiles` leaves out one model per matching profile.
- `limit` caps how many of the unit a `group`, `contingent` or the `list` may hold (a number or expression).

### Weapons, equipment, special rules

- `weapons`: `{ id, name, template, profiles: [{ name, stats, traits?, specialRules? }] }`, `template` a weapon stat template of the game.
- `equipment`: `{ id, name, text }`.
- `specialRules`: `{ id, name, text, configurable?, defaultValue?, grants? }`. Units and profiles use them as `{ "id", "value"? }` in `specialRules`. `grants` gives contingent resources and may use `rule.value()`.

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

Effects appear on `Option.effects`, slot options, and sub-faction unit modifiers. `when` on an effect holds it back until true.

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

### Selectors

A **UnitSelector** picks units: `{ "unitIds": [...], "roles": [...], "profiles": { "anyOf": [...], "noneOf": [...] } }` (omitted field matches all). Anywhere one is accepted, `"@name"` refers to a **NamedSelector** in `selectors` (`{ "id", "name", "match": <UnitSelector> }`), looked up in the faction (with its sub-faction), then the game.

### Slot options (benefits for tagged slots)

`slotOptions`: `{ "id", "name", "text", "slotTag", "slotRoles"?, "cost"?, "effects"? }`. A slot with the tag offers one option; effects are stat/special-rule effects, plus at most one `{ "kind": "slot", "roleChoices": [...] }` (an extra slot) and one `{ "kind": "allowedRoles", "roles": [...] }`.

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

When the rules let an army make more than one independent pick (a Cohort Doctrine **and** a Designation, or one Provenance plus another under a condition), declare each pick as a group on the **faction** and put each sub-faction in one:

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

- `min` defaults to 0 and `max` to 1. Both may be expressions over `contingent`, `root` and `list`.
- Leave `group` out and the sub-faction is in the `default` group (at most one): a faction with a single pick (one Legion) needs no groups at all. Declare `default` in `subFactionGroups` if you want to name it or set `"min": 1`.
- `when` restricts a sub-faction: Traitor-only (`choice(allegiance) == traitor`), or needing another pick (`list.is(subfaction:…)`). Same scopes as the group limits.
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
| detachment `when` | `contingent`, `root`, `list` |
| detachment `min`/`max` | `group`, `contingent`, `root`, `list` |
| slot `when`/`repeat.max`, slot options | `slot`, `group`, `contingent`, `root`, `list` |
| unit `when`/`limit.max`/cost | `unit`, `slot`, `group`, `contingent`, `root`, `list` |
| upgrade `when`/`min`/`max` | the unit's, plus `profile` when the upgrade has a `profileId` |
| option `when`/`max`/cost, sub-choice values | `option`, plus an upgrade's |
| stat / special-rule effect `when` | `profile`, `unit`, `slot`, `group`, `contingent`, `root`, `list` |
| special rule `grants` | `rule`, `unit`, `slot`, `group`, `contingent`, `root`, `list` |
| group type `min`/`max`, list rules | `list` (count rules limited to a contingent or group also see those and `root`) |

**Functions per scope:**

| Scope | Functions |
| --- | --- |
| `rule` | `value()` |
| `option` | `picks()`, `choice(sub-choice)` |
| `profile` | `count(wargear)`, `has(wargear)`, `is(type: or tag:)` |
| `unit` | `count(wargear)`, `has(wargear)`, `is(unit:/role:/type:/tag:/@sel)`, `sum(resource)`, `limit(unit resource)`, `models()` |
| `slot` | `is(tag: or role:)` |
| `group`, `root` | `count(unit ref or wargear)`, `has(...)`, `is(type: or group:)`, `sum(resource[, unit ref])` |
| `contingent` | `count(unit ref, wargear or group:)`, `has(...)`, `is(faction: or subfaction:)`, `sum(resource[, unit ref])` |
| `list` | as `contingent`, plus `limit(list resource)` |

Global: `choice(name)` (a list choice; compare with its value bare: `choice(stance) == defensive`), `floor(x)`, `ceil(x)`, `min(a, b, …)`, `max(a, b, …)`.

**References** are arguments only, `kind:id` with no spaces: `unit:`, `role:`, `type:` (a unit type, or a group type on `group`/`root`), `tag:` (lowercase-hyphen form of a free-text tag; a slot tag on `slot`), `weapon:`, `equipment:`, `group:` (a group type or detachment; the game's word works too), `faction:`, `subfaction:`; and `@id` for a named selector. `unit.count(role:troop)` is not allowed (on a unit `count`/`has` only count wargear; use `unit.is(role:troop)`).

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
