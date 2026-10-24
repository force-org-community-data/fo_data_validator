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
