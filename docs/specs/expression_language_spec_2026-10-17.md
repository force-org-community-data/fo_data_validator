# Expression language specification

Draft 1, 2026-10-17 (open questions resolved the same day). Status: implemented (`src/expressions/`); versioning is still to do (§14). Companion to `data_schema_spec_2026-10-17.md`; decisions and their reasoning are in the Force Org app repo (`docs/multi_game_and_external_data_plan_2026-10-17.md`, "Rules layer").

## 1. Purpose

Data is written with typed rules first: restrictions, sub-faction modifiers, resource caps, per-model config, slot options and contingent resources. Expressions are the **escape hatch** for list rules no typed form covers. They:

- appear only in a few fields (§3);
- read the list but never change it: no assignments, no side effects;
- always finish: no loops, no recursion, no user-defined functions;
- are checked when a data source loads (syntax, names, scopes and types), with errors that point at the problem and suggest fixes.

The language has a fixed vocabulary of scopes and verbs (§8–§10). It is meant to be small enough that data authors can learn all of it in one sitting.

## 2. A taste

```
1 + floor(root.count(role:troop) / 2)              max of a detachment
choice(stance) == defensive                       when of an option
contingent.count(@line-troops) >= 3               when of a stat effect
list.limit(points) >= 3000                          when of a detachment
1 + floor(contingent.count(unit:squad) / 2)   max of a unit
list.limit(credits)                                 min and max of a count rule
```

If a game's `terms` give them words, e.g. `core.` and `formation.`, those may be written for `root.` and `group.` (§8.3).

## 3. Where expressions appear

| Field | Found on | Result |
| --- | --- | --- |
| `when.if` | units, upgrades, options, detachments, slots, stat and special-rule effects, expression list rules | bool |
| `min`, `max` | upgrades, options, detachments, group types, count list rules, unit `limit.max`, slot `repeat.max` | number |
| cost values | `cost` maps on units and options (`{ "points": "…" }`) | number |

A numeric field holds either a plain number or an expression string; a `when` is always a **condition object** with the player-facing reason:

```json
"when": { "if": "choice(stance) == defensive", "message": "Defensive forces only" }
```

Typed numeric fields keep generated messages ("At most 2"); typed list rules carry their own `message`.

## 4. Lexical structure

Expressions are ASCII. Whitespace (spaces, tabs, newlines) separates tokens and is otherwise ignored, with one exception in §4.5.

### 4.1 Numbers

`[0-9]+(\.[0-9]+)?`, e.g. `3`, `0.5`. There are no negative literals; `-3` is unary minus applied to `3`.

### 4.2 Names

`[a-z][a-z0-9]*(-[a-z0-9]+)*`: lowercase, starting with a letter, with single hyphens **inside** the name (`heavy-support`, `equipment-slots`). A hyphen directly between name characters is part of the name, so `a-b` is one name, not a subtraction. Write subtraction with spaces (`a - b`) or after a non-name token (`count(role:troop)-1`). An unknown name that contains a hyphen gets the hint "did you mean `a - b`?".

Names are scopes (`group`), function names (`count`), choice names and values (`stance`, `defensive`) and resource ids (`points`).

### 4.3 Keywords

`and`, `or`, `not`, `true`, `false`. They can't be used as names.

### 4.4 References and selectors

- **Reference:** `kind:id`, a name, a colon and an id, **with no whitespace** around the colon: `role:troop`, `unit:squad`, `weapon:twin-blades`. Ids follow the record id rule `[a-z0-9]+(-[a-z0-9]+)*`.
- **Selector reference:** `@id`, e.g. `@line-troops`.

Both may appear **only as call arguments** (§5).

### 4.5 The conditional's colon

Because `name:id` with no spaces is a reference, the `:` of a conditional must not touch a name on both sides. `x ? 1 : 0` and `x ? 1:0` are fine; `x ? a:b` lexes `a:b` as a reference and is rejected with "references can only be call arguments; for a conditional put spaces around ':'".

### 4.6 Operators and punctuation

`+ - * /`, `== != < <= > >=`, `? :`, `( )`, `,`, `.`. There are no strings, comments, `%`, `**`, brackets or braces.

## 5. Grammar

```ebnf
expression     = conditional ;
conditional    = or_expr [ "?" conditional ":" conditional ] ;   (* right-associative *)
or_expr        = and_expr { "or" and_expr } ;
and_expr       = not_expr { "and" not_expr } ;
not_expr       = "not" not_expr | comparison ;
comparison     = additive [ compare_op additive ] ;              (* not chainable *)
compare_op     = "==" | "!=" | "<" | "<=" | ">" | ">=" ;
additive       = multiplicative { ( "+" | "-" ) multiplicative } ;
multiplicative = unary { ( "*" | "/" ) unary } ;
unary          = "-" unary | primary ;
primary        = NUMBER | "true" | "false" | call | NAME | "(" expression ")" ;
call           = [ NAME "." ] NAME "(" [ argument { "," argument } ] ")" ;
argument       = REFERENCE | SELECTOR | expression ;
```

Precedence, lowest to highest: `?:`, `or`, `and`, `not`, comparisons, `+ -`, `* /`, unary `-`, calls and parentheses. `a < b < c` is an error ("comparisons can't be chained; use `and`").

## 6. Feature ceiling

These are **not** in the language, and adding any of them needs a spec change (and a language version, §14):

- variables, assignment, `let`;
- user-defined functions, lambdas, macros (`exists`, `filter`, `map`);
- loops, recursion;
- field or property access (`unit.name`, `unit.stats.ld`); the `.` only joins a built-in scope to a verb;
- strings, lists, maps, null;
- side effects of any kind.

Every expression therefore finishes in time proportional to its length times the size of the list.

## 7. Types

| Type | Values | Produced by |
| --- | --- | --- |
| `number` | decimals | literals, arithmetic, `count`, `sum`, `limit`, `models`, `picks`, `floor`/`ceil`/`min`/`max` |
| `bool` | `true`, `false` | comparisons, `and`/`or`/`not`, `has`, `is` |
| `enum<C>` | the values of choice `C` | `choice(C)` |

References and selectors aren't values; they only exist as arguments.

Rules, all checked when data loads:

- arithmetic and `<`, `<=`, `>`, `>=` take numbers;
- `==` and `!=` take two numbers, two bools, or `choice(C)` and a value name of `C` (`choice(stance) == defensive`); a value that isn't one of `C`'s gets "did you mean";
- `and`, `or`, `not` and the condition of `?:` take bools;
- both branches of `?:` must have the same type;
- there are no implicit conversions (`true + 1` is an error).

## 8. Scopes

### 8.1 Built-in scopes

| Scope | Is | Notes |
| --- | --- | --- |
| `rule` | a special rule on the unit, in that rule's `grants` | its value (`rule.value()`) |
| `option` | the option being priced or allowed | its picks and sub-choices |
| `profile` | the profile an upgrade belongs to (e.g. the sergeant) | only where the upgrade has a `profileId` |
| `unit` | the unit being built or considered | |
| `slot` | the slot the unit fills | its roles and tags |
| `group` | the unit's container: a detachment, formation, retinue or team, whatever the game calls it | |
| `contingent` | a root group plus the groups linked to it, sharing one faction source | e.g. a core or allied formation with the reserve and elite formations linked to it. Games without linking have one contingent per group, or one for the whole list |
| `root` | the contingent's root group | a game may call it `core` |
| `main` | the list's main contingent: the one whose root group's type has `source: main` | the same verbs as `contingent`; for the main contingent's own rules it is their `contingent`. Lets an allied contingent follow the main one, e.g. `main.is(subfaction:dark-angels)`. Added in validator 1.2.0 |
| `list` | the whole list | points limit, list choices, totals across all contingents |

### 8.2 Which scopes each field may use

A field sees its own subject and everything containing it.

| Expression lives on… | Scopes |
| --- | --- |
| Detachment `when` / `max` | `contingent`, `root`, `main`, `list` (+ `group` for rules checked after the detachment is added) |
| Slot `when`, `repeat.max` | `slot`, `group`, `contingent`, `root`, `main`, `list` |
| Unit `when`, `limit.max`, `cost` | `unit`, `slot`, `group`, `contingent`, `root`, `main`, `list` |
| Upgrade `when` / `min` / `max` | `profile` (with `profileId`), `unit`, `slot`, `group`, `contingent`, `root`, `main`, `list` |
| Option `when` / `max` / `cost` | `option`, plus everything an upgrade sees |
| Stat / special-rule effect `when` | `profile`, `unit`, `slot`, `group`, `contingent`, `root`, `main`, `list` |
| Trait effect `when` | as a stat effect's, without `profile` |
| Special rule `grants` | `rule`, `unit`, `slot`, `group`, `contingent`, `root`, `main`, `list` |
| Sub-faction `when`, sub-faction group `min` / `max` | `contingent`, `root`, `main`, `list`: the contingent the sub-faction is taken for |
| Group type `min` / `max`, list rules | `main`, `list` (a `count` list rule with `scope: contingent` or `group` also sees that scope, `root`, `main` and `list`) |

Using another scope is a load error: "'unit' isn't available here (allowed: contingent, group, list, root)".

### 8.3 The game's own words

A game's `terms` map gives built-in scopes a `word` (`"group": { "word": "formation", … }`). Authors may write either the game's word or the built-in name; the checker translates game words to built-in names before checking. The same word also works as the reference kind for groups (`formation:reserve` = `group:reserve`). Internally the engine and TypeScript mechanics only use built-in names.

## 9. References

### 9.1 Kinds

| Kind | Refers to | Defined in |
| --- | --- | --- |
| `unit:` | a unit record | faction / sub-faction |
| `role:` | a role | game `roles` |
| `type:` | a unit type, or a group type (§9.2) | game `unitTypes` / `groupTypes` |
| `tag:` | a unit or profile tag, or a slot tag (§9.2) | unit and profile `tags` / game `slotTags` |
| `trait:` | a unit trait (validator 1.2.0) | unit `traits` and trait effects, in any faction of the game |
| `weapon:` | a weapon record | faction |
| `equipment:` | an equipment record | faction |
| `group:` (or the game's word) | a group type or a specific detachment record | game `groupTypes`, game and faction `detachments` |
| `faction:` | a faction | data sources in use |
| `subfaction:` | a sub-faction | data sources in use |
| `@id` | a named selector | faction (with its sub-faction), then game |

Group type ids and detachment ids must not collide within a game, since `group:` matches either.

### 9.2 Looked up against the scope it's asked about

The same kind can mean different things on different scopes; the checker knows each scope's type, so it stays unambiguous:

- `tag:` on `slot` means the game's slot tags; on `unit` and `profile` the unit's and profile's tags;
- `type:` on `unit`/`profile` means unit type; on `group`/`root` group type.

Traits are free text too and match the same way (`trait:infantry-tercio` for `Infantry Tercio`). A unit's traits include those effects give it (data schema spec §5.2), so the known traits are every unit's `traits` plus every trait effect's `add` and `replace.to`, across all the game's factions (`main` and `list` see other factions' units). An unknown `trait:` is a warning. On a profile, `is(trait:…)` tests its unit's traits.

Unknown ids get "did you mean". Tags are free text in unit data (`Sergeant`, `Heavy Assault`), so a `tag:` reference matches them case-insensitively and writes them in id form, lowercase with hyphens (`tag:sergeant`, `tag:heavy-assault`), the same way profile filters match. An unknown `tag:` on a unit is a lint warning (no unit in the faction has it), not an error.

### 9.3 Named selectors

`@id` refers to a `NamedSelector` (`match` is a `UnitSelector`). Resolution: the faction's own selectors (with its sub-faction's merged in), then the game's. Selectors are allowed wherever a unit-matching reference is.

## 10. Functions

### 10.1 Scoped verbs

| Verb | On | Arguments | Returns | Meaning |
| --- | --- | --- | --- | --- |
| `count(ref)` | `group`, `contingent`, `root`, `main`, `list` | unit ref (`unit:`/`role:`/`type:`/`tag:`/`trait:`/`@`) | number | units in scope that match. Not on `unit`: test the unit itself with `unit.is(…)` |
| | `profile`, `unit`, `group`, `contingent`, `root`, `main`, `list` | wargear ref (`weapon:`/`equipment:`) | number | amount held in scope, counted as the restriction engine does: default wargear (per model where set), plus picks, minus swaps |
| | `contingent`, `main`, `list` | group ref | number | groups in scope of that type or detachment |
| `has(ref)` | as `count` | as `count` | bool | `count(ref) > 0` |
| `is(ref)` | `unit` | unit ref | bool | the unit matches |
| | `profile` | `type:`, `tag:`, `trait:` | bool | the profile (with its unit's type, tags and traits) matches |
| | `slot` | `tag:`, `role:` | bool | the slot has that tag / accepts that role |
| | `group`, `root` | `type:`, group ref | bool | the group is of that type or detachment |
| | `contingent`, `main`, `list` | `faction:`, `subfaction:` | bool | the contingent's faction source (or the list's main one); `subfaction:` is true when it is any of the sub-factions taken |
| `sum(resource[, ref])` | `unit`, `group`, `contingent`, `root`, `main`, `list` | resource name, optional unit ref | number | resource spent in scope, optionally only on matching units |
| `limit(resource)` | `list` | list resource | number | the player's limit (e.g. points limit) |
| | `unit` | unit resource | number | the unit's capacity (e.g. equipment slots, from the resource's `capacityStat`) |
| `models()` | `unit` | none | number | models in the unit, including additional models (with composition blocks: every copy of every block) |
| `picks()` | `option` | none | number | times the option has been taken |
| `value()` | `rule` | none | number | the rule's value on the unit, or its `defaultValue`; an error (the grant counts as 0) when it has neither or it isn't a number |
| `choice(name)` | `option` | sub-choice id | `enum` | the option's sub-choice value (e.g. `option.choice(facing) == turret`) |

### 10.2 Global functions

| Function | Returns | Notes |
| --- | --- | --- |
| `choice(name)` | `enum<name>` | a list-level choice from the game's `choices`; must be compared with one of its values |
| `floor(x)`, `ceil(x)` | number | round down / up |
| `min(a, b, …)`, `max(a, b, …)` | number | two or more numbers |

## 11. Evaluation

- **Live.** Expressions are re-evaluated whenever the list changes.
- **Candidates are evaluated as if placed.** A unit in the picker is evaluated as if it were in the slot; a detachment in the Add menu as if it were in the list.
- **`when` false on something not picked:** it's shown disabled with the condition's `message` (the "prevent, don't report" rule).
- **`when` false on something already picked:** a list alert with the `message`; nothing is removed automatically. Only typed rules auto-fix, because they know how.
- **`min` / `max`:** compared live; a result that isn't a whole number is rounded down. Use `floor` / `ceil` to make rounding explicit.
- **`cost`:** must be zero or more.
- **Evaluation errors** (division by zero, a negative cost) never crash the builder: the rule is treated as not met (`when` false, `max` 0, `min` unmet, the item can't be priced) and shown as a data error naming the source, record and field.
- **Determinism:** the same list and data always give the same result.

## 12. Checking

When a data source loads, every expression goes through:

1. **parse** (§4–§5);
2. **names:** scopes (built-in or the game's words), functions, choices and values, resources;
3. **scopes:** each scope is allowed for the field (§8.2), each verb exists on its scope (§10.1);
4. **references:** kinds allowed for the verb and scope, ids exist (§9);
5. **types** (§7) and the field's result type (§3);
6. **lint** (§13).

Errors name the source, file, record path and field, with a column and a suggestion where possible:

```
github.com/example/data · factions/field-army.json
units/squad/upgrades/squad-options/options/grenades · when
  choice(stance) == defensiv
                    ^ 'defensiv' isn't a value of stance (did you mean 'defensive'?)
```

Errors stop that game or faction from loading and appear in the app's source report. The same checker ships as a CLI / GitHub Action for data repos (§13).

## 13. Lint: typed rules first

Rule shapes that have a typed form must use it; expressions don't get helpers that duplicate them (no `percent()`, `perModel()`, `swap()`). The checker flags exact duplicate patterns, starting with:

| Pattern | Use instead |
| --- | --- |
| an option's or upgrade's `when.if` is `not unit.has(weapon:X)` / `not unit.has(equipment:X)` | `restrictions.exclusions` (works both ways, auto-fixes) |
| an option's or upgrade's `when.if` is `unit.has(weapon:X)` / `unit.has(equipment:X)` | `restrictions.required` |
| `list.sum(R, …) <= list.limit(R) * N` (or `/ N`) | a `resourceCap` list rule |
| an expression list rule whose `if` is `list.count(ref) <= N` | a `count` list rule |
| an expression with no scoped calls, e.g. `max: "1 + 1"` | a plain value |
| a `when` that is always true or always false for every list | remove it, or fix the condition |

Where it's enforced:

- **The app:** warnings in the source report; it can't reject data from arbitrary sources.
- **The CLI / GitHub Action:** failures, for data repos that adopt it.
- **Our own managed data repo (later):** hard CI checks on every pull request, so everything in it is known to work.

## 14. Versioning

The language has a whole-number version, `EXPRESSION_VERSION` in `src/game_data/versions.ts` (currently 1). A source declares the version its expressions are written for as `expressionVersion` in its `forceorg.json`, next to `schemaVersion` (decided 2026-10-21); every expression in the source, extensions included, is read under that one version.

- **What bumps it:** only an incompatible change: removed or re-meant syntax, functions, scopes or operators, or a changed result for the same expression. Additions (a new function, a new scope) don't bump it, since older data never uses them.
- **Newer than the app:** the source is refused, with an error telling the user to update Force Org (as for `schemaVersion`). The bundled loader skips the source; `fo-validate` reports the error.
- **Older than the oldest supported:** refused with a message that the source needs updating.
- **Missing:** read as version 1, with a warning to add the field. It becomes required once a version 2 exists.
- **When the language changes incompatibly:** raise `EXPRESSION_VERSION`, keep the previous behaviour reachable under the old version (lexer, parser, checker and evaluator take the version), and note the change and how to migrate here and in the authoring guide. Until then there is one language and nothing to branch on.

## 15. Implementation notes

- **Engine: our own** (decided 2026-10-17): a hand-written lexer, recursive-descent parser, checker and evaluator in TypeScript, with zero new dependencies. It gives full control over syntax, error messages and the feature ceiling. (CEL would have needed a translation step and jsep plugins, since hyphenated names, `kind:id` references, `@` selectors and word operators aren't valid in either.)
- **Implementation status:** the lexer, parser and checker (§4–§13) are in `src/expressions/` with tests in `tests/expressions.test.ts`; they check every expression in `examples/` cleanly. The evaluator (§11) is in `evaluator.ts`, evaluating against an `EvaluationContext` interface (each scope's view of the list); backing it with real lists comes with the new list model.
- **Prototype:** a throwaway Python prototype of §4–§12 (lexer, recursive-descent parser, checker) checked every expression in `examples/` and a set of deliberately wrong ones; it found no ambiguity in the grammar. It suggests our own implementation is a few hundred lines plus error formatting and tests, within the earlier 3–5 day estimate.
- Expressions are stored as plain strings in the data, so the engine can change later without touching data.

## 16. Resolved questions

- **`count` on `unit` with a unit reference:** not allowed; test the unit itself with `unit.is(…)`, so there's one way to write it. `unit.count(weapon:…)` / `unit.has(weapon:…)` for wargear are unaffected.
- **`sum` over sub-choices or per-option values:** deferred until a real rule needs it; `option.picks()` and `option.choice(…)` cover today's cases.
- **Constant and always-true expressions:** lint warnings (§13). Detecting "always true" is best-effort (e.g. comparing a count with a negative number), not a proof.
