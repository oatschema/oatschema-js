# oatschema

[![npm](https://img.shields.io/npm/v/oatschema.svg)](https://www.npmjs.com/package/oatschema)
[![CI](https://github.com/oatschema/oatschema-js/actions/workflows/ci.yml/badge.svg)](https://github.com/oatschema/oatschema-js/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://github.com/oatschema/oatschema-js/blob/main/LICENSE)

The [OATS](https://oatschema.org) (Open Annotation Task Schemas) JSON schemas for JavaScript and TypeScript.

OATS is a collection of strict, versioned JSON Schema 2020-12 schemas, defining and validating the structured outputs of machine learning models, workflow steps and annotation. Models, pipelines and people write the same JSON for each task, so a classification, a transcription or a set of detected objects has one shape, whatever produced it. This package bundles the schemas so you can validate those records anywhere. (OATS is unrelated to the W3C Web Annotation data model, formerly Open Annotation.)

- **No dependencies, no I/O.** The schemas are embedded in the module, so the package works the same in Node.js 22+, browsers, Deno, Bun and any bundler.
- **Exactly as released.** Each schema is byte-identical to its [oatschema/oats](https://github.com/oatschema/oats) release.
- **Typed.** ESM with TypeScript types. Schema names are a union type, so typos fail at compile time.

## Quick start

```
npm install oatschema
```

```ts
import { getSchema, SCHEMA_VERSION } from "oatschema";

const schema = getSchema("classification"); // a fresh plain object, safe to modify
schema.$id; // "https://oatschema.org/0.8.0/classification"
SCHEMA_VERSION; // "0.8.0", used when you don't pass a version
```

## Schemas

| Name | Holds |
| :--- | :--- |
| `audio-transcription` | Transcribed speech, with timed segments, speakers and non-verbal events |
| `classification` | Predicted labels with scores and an optional vocabulary |
| `document-extraction` | Document layout and content: text blocks, coordinates and pages |
| `embedding` | A dense or sparse vector and the model that produced it |
| `entity-extraction` | Entities linked to their evidence, and relations between them |
| `generic` | Arbitrary key-value data |
| `geolocation` | A geographic feature, as a strict subset of GeoJSON |
| `llm-output` | One prompt and response, with generation parameters and usage |
| `object-detection` | Boxes, polygons and their hierarchy within a source |
| `ranking` | Ranked results for a query, such as search or retrieval hits |
| `regression` | Numeric predictions, intervals and forecasts |
| `temporal-segmentation` | Labelled time intervals, such as chapters, scenes or speaker turns |

Browse every schema, its fields and the changelog at [oatschema.org](https://oatschema.org).

## Validating records

`getSchema` returns a plain object for any JSON Schema 2020-12 validator. With [Ajv](https://ajv.js.org):

```ts
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { getSchema } from "oatschema";

const ajv = new Ajv2020({ allErrors: true, strictTypes: false, strictTuples: false, strictRequired: false });
ajv.addKeyword({ keyword: "x-license", schemaType: "object" });
ajv.addKeyword({ keyword: "x-version", schemaType: "string" });
addFormats(ajv);

const validate = ajv.compile(getSchema("classification"));
validate({ labels: [{ label: "cat", score: 0.92 }] }); // true
validate({ labels: [{ label: "cat", score: 1.5 }] }); // false: /labels/0/score must be <= 1
```

- `x-license` and `x-version` are the only non-standard keywords in OATS. Registering them keeps Ajv's strict mode on for everything else.
- The three relaxed options switch off Ajv's style checks, which reject some valid 2020-12 patterns that OATS uses, such as `required` inside an `if`.
- Compile each schema once per Ajv instance and reuse the function. Compiling a second copy with the same `$id` throws; fetch the first with `ajv.getSchema(schema.$id)`.

## API

| Export | Description |
| :--- | :--- |
| `getSchema(name, version?)` | The schema as a new object on every call |
| `getSchemaJson(name, version?)` | The schema file's text, exactly as released |
| `availableVersions()` | Every bundled schema version, oldest first |
| `SCHEMA_VERSION` | The default schema version, the newest bundled |
| `SCHEMA_NAMES`, `SchemaName` | The schema names, as an array and a union type |
| `UnknownSchemaError` | Thrown for a name that exists in no bundled version |
| `SchemaLookupError` | Thrown for a version that isn't bundled, or that lacks the schema |

- `version` must be exact: `"0.8.0"`, never `"0.8"` or `"latest"`.
- Both errors carry the requested `schemaName`, and `SchemaLookupError` also carries `schemaVersion`.

## Versions

**Schema versions.** Before OATS 1.0, a new release may reject records an older one accepted, or the reverse, so pass the version a record was written for.

- Each `$id` includes its version (`https://oatschema.org/0.8.0/classification`), so several versions can share one Ajv instance.
- Each schema states its own version in `x-version`.
- This package bundles OATS 0.8.0, the first public release, and every later one. For 0.4.0 to 0.7.0, use the Python package, [oatschema-py](https://github.com/oatschema/oatschema-py).

**Package versions.** The package has its own semantic version, which never encodes a schema version; read `SCHEMA_VERSION` instead. Upgrading never removes a schema version, but it can move the default. Before 1.0, a release that changes the default is a minor bump, so npm's default `^0.x.y` range keeps your default fixed.

## Contributing

Schema changes belong in [oatschema/oats](https://github.com/oatschema/oats). For this package, see [CONTRIBUTING.md](https://github.com/oatschema/oatschema-js/blob/main/CONTRIBUTING.md). Commits need a DCO sign-off (`git commit -s`).

## License

Apache-2.0. Copyright [The OATS Authors](https://github.com/oatschema/oatschema-js/blob/main/AUTHORS).
