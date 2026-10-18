# Changelog

This package uses its own semantic version. `SCHEMA_VERSION` gives the default OATS schema version of each release.

## 0.0.1 (2026-10-18)

First release. Schema access only; validation is planned for 0.1.0.

- Bundles OATS schema version 0.8.0, the first public OATS release, copied unchanged from the `oatschema/oats` release tag. Its 12 schemas are `audio-transcription`, `classification`, `document-extraction`, `embedding`, `entity-extraction`, `generic`, `geolocation`, `llm-output`, `object-detection`, `ranking`, `regression` and `temporal-segmentation`. `SCHEMA_VERSION` is 0.8.0.
- `getSchema`, `getSchemaJson`, `availableVersions`, `SCHEMA_VERSION`, `SCHEMA_NAMES` and `SchemaName`.
- `UnknownSchemaError` and `SchemaLookupError`.
