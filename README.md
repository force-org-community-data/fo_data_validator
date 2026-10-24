# Force Org Data Validator

Maintained in collaboration with the Force Org devs to make sure all community data matches the expected schema.

This repository is the single home of:

- the **data schema** (zod schemas in `src/game_data/schema.ts`, the source of truth) and the JSON Schema generated from it (`schema/`),
- the **checker**: shape check, data checker (ids, references, stats, expressions) and version checks,
- the **expression language** (lexer, parser, checker, evaluator),
- the **`fo-validate` CLI** that data authors and CI run,
- the **authoring docs, specs and example sources** (`docs/`, `examples/`).

No game data lives here; the examples are illustrative.

## Validate a data source

```bash
npm install
node bin/fo-validate.mjs <source dir> [<extension source dir>] [--json]
```

Exits 1 when there are errors. In a data repo, add this package as a dependency pinned to a release tag and run `npx fo-validate <source dir>`:

```json
"@force-org/data-validator": "git+https://github.com/force-org-data-team/fo_data_validator.git#v1.0.0"
```

(Use the explicit `git+https` form, not the `github:` shorthand, which can resolve to SSH and fail on CI.) Nothing is published to the npm registry.

`npm run validate-data` runs the CLI over every source in `examples/`.

## Validate in CI (data repos)

A data repo depends on this package through its git URL (see above), so its CI installs the pinned validator and runs the CLI. No separate action is needed:

```yaml
# .github/workflows/validate.yml in the data repo
name: Validate data
on:
    push:
        branches: [main]
    pull_request:
jobs:
    validate:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: actions/setup-node@v4
              with:
                  node-version: 22
                  cache: npm
            - run: npm ci
            - run: npx fo-validate . # add a second folder to check an extension: npx fo-validate base-source .
```

The data repo's `package.json` needs only the dependency line shown above, with its lockfile committed. Updating the validator is changing the tag in that line (Renovate or Dependabot can do it).

## Editor support (`$schema`)

Each data file can point its editor at the matching JSON Schema for completion and inline errors. The Force Org app ignores the key.

```json
{
    "$schema": "https://cdn.jsdelivr.net/gh/force-org-data-team/fo_data_validator@1/schema/faction.schema.json"
}
```

Files: `source-manifest`, `game`, `faction` and `sub-faction` (each `<name>.schema.json`).

- `@1` resolves to the newest `1.x.x` tag, so the URL stays valid across minor and patch releases and changes only on a major bump (a data format or expression language change). Use an exact tag (`@1.2.3`) for a frozen schema; jsDelivr serves tags immutably.
- `@1` is cached for up to 12 hours on the CDN and 7 days in browsers, so a schema change can reach editors late. That is acceptable for schemas.
- jsDelivr reads git tags, not GitHub Releases, and needs the repository to be public. Prerelease tags (`v2.0.0-beta.1`) are skipped when resolving `@1`.
- Inside this repo, `examples/full` points at the local `schema/` files instead.

## Using it as a library

- `@force-org/data-validator`: browser-safe API (schemas, inferred types, `checkShapes`, `validateGameData`, versions, expressions, `buildVocabulary`, ...).
- `@force-org/data-validator/node`: `readSource` / `readSourceSync` (Node only).
- `@force-org/data-validator/schema/*`: the generated JSON Schema files.

TypeScript source is shipped as is; consumers transpile it (e.g. Next's `transpilePackages`).

## Development

```bash
npm test               # node:test suites in tests/
npm run type-check
npm run lint
npm run generate-schema            # regenerate schema/*.schema.json (add -- --check to verify)
```

Change a schema, then run `npm run generate-schema`; a test fails when `schema/` is stale. The schema output depends on the zod version, so `package.json` requires `zod@^4.6.0`.

## Docs

- [Data authoring guide](docs/data_authoring_guide.md)
- [Data schema spec](docs/specs/data_schema_spec_2026-10-17.md)
- [Expression language spec](docs/specs/expression_language_spec_2026-10-17.md)
- [Examples](examples/README.md)

## Versions

`SCHEMA_VERSION` (data format) and `EXPRESSION_VERSION` (expression language) only go up on incompatible changes. The package's semver major bumps whenever either does.

## Releasing

1. Make sure `npm test`, `npm run type-check`, `npm run lint`, `npm run generate-schema -- --check` and `npm run validate-data` pass (CI runs them).
2. Set the new version in `package.json` (`npm version <x.y.z> --no-git-tag-version`). A change to `SCHEMA_VERSION` or `EXPRESSION_VERSION`, or any other incompatible change, is a **major** bump. Whenever the major changes, run `npm run generate-schema`: it sets each schema's `$id` to the new `@<major>` URL.
3. Commit, then tag and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`. A GitHub Release is not needed; jsDelivr and npm's git installs read tags.
4. Consumers update the tag in their `package.json` dependency.
