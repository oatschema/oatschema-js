# Changelog

This package uses its own semantic version. `SCHEMA_VERSION` gives the default OATS schema version of each release.

## 0.1.0 (2026-10-30)

Validation, with precompiled validators.

- `oatschema/validate`: `validate`, `isValid`, `iterErrors` and `getValidator`, for a schema name, an optional schema version and `{ checkFormats }`. `validate` throws a `ValidationError` for the first error, and `iterErrors` yields every error. Validators are cached.
- `oatschema/validate/<name>`: `getValidator` for one schema, so a page loads only that schema's validator.
- The validators are compiled ahead of time, generate no code at run time and import nothing outside the package, so they run under a strict Content Security Policy (`script-src 'self'`) and in a browser without a bundler. The package still has no runtime dependencies.
- `ValidationError` has `message`, `reason`, `path`, `keyword`, `schemaPath`, `schemaName` and `schemaVersion`. It shows values from the record as `…`, and its size is bounded whatever the record holds: `reason` is at most 1,000 characters and each path string at most 100.
- Failures inside `anyOf`, `oneOf` and `if`/`then` are reported as oatschema-py reports them: one error for a failed `anyOf` or `oneOf`, and the `then` error without a separate `if` error.
- Verdicts match oatschema-py on every example in the OATS 0.8.0 release, with format checks on and off. One known difference: integers above 2^53, which `JSON.parse` rounds, can make a `uniqueItems` list fail.
- `date-time` follows RFC 3339 strictly, and `uri` accepts any absolute RFC 3986 URI. Both match the format checks oatschema-py uses.
- `oatschema/ajv`: `addOatsKeywords(ajv)` and `addOatsFormats(ajv)`, for people who validate with their own Ajv.
- `SchemaVersion`, a union of the bundled versions, and `isSchemaVersion(value)`. Every `version` parameter now takes a `SchemaVersion`, and `availableVersions()` returns `SchemaVersion[]`. **Breaking for TypeScript callers** that pass a `string`; narrow it with `isSchemaVersion` first. JavaScript callers are unaffected.
- `UnknownSchemaError` and `SchemaLookupError` keep their names. Their messages shorten a long requested name or version.
- The package now ships `AUTHORS`, and `THIRD-PARTY-NOTICES` with Ajv's MIT licence, which covers the generated validator code.
- Published from GitHub Actions with npm trusted publishing and provenance.

## 0.0.1 (2026-10-18)

First release. Schema access only; validation is planned for 0.1.0.

- Bundles OATS schema version 0.8.0, the first public OATS release, copied unchanged from the `oatschema/oats` release tag. Its 12 schemas are `audio-transcription`, `classification`, `document-extraction`, `embedding`, `entity-extraction`, `generic`, `geolocation`, `llm-output`, `object-detection`, `ranking`, `regression` and `temporal-segmentation`. `SCHEMA_VERSION` is 0.8.0.
- `getSchema`, `getSchemaJson`, `availableVersions`, `SCHEMA_VERSION`, `SCHEMA_NAMES` and `SchemaName`.
- `UnknownSchemaError` and `SchemaLookupError`.
