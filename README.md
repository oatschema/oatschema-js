# oatschema

[![npm](https://img.shields.io/npm/v/oatschema.svg)](https://www.npmjs.com/package/oatschema)
[![CI](https://github.com/oatschema/oatschema-js/actions/workflows/ci.yml/badge.svg)](https://github.com/oatschema/oatschema-js/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://github.com/oatschema/oatschema-js/blob/main/LICENSE)

The [OATS](https://oatschema.org) (Open Annotation Task Schemas) JSON schemas and validators for JavaScript and TypeScript.

OATS is a collection of strict, versioned JSON Schema 2020-12 schemas, defining and validating the structured outputs of machine learning models, workflow steps and annotation. Models, pipelines and people write the same JSON for each task, so a classification, a transcription or a set of detected objects has one shape, whatever produced it. This package bundles the schemas so you can validate those records anywhere. (OATS is unrelated to the W3C Web Annotation data model, formerly Open Annotation.)

- **No dependencies, no I/O.** The schemas are embedded in the module, so the package works the same in Node.js 22+, browsers, Deno, Bun and any bundler.
- **Validation built in.** Validators are compiled ahead of time, so they generate no code at run time. They work under a strict Content Security Policy (`script-src 'self'`) and in a browser page without a bundler, and a page can load the validator for one schema only.
- **Same verdicts as Python.** On every example in the OATS release, the validators agree with [oatschema-py](https://github.com/oatschema/oatschema-py), with format checks on and off.
- **Exactly as released.** Each schema is byte-identical to its [oatschema/oats](https://github.com/oatschema/oats) release.
- **Typed.** ESM with TypeScript types. Schema names and versions are union types, so typos fail at compile time.

## Quick start

```
npm install oatschema
```

```ts
import { getSchema, SCHEMA_VERSION } from "oatschema";
import { validate, isValid } from "oatschema/validate";

const schema = getSchema("classification"); // a fresh plain object, safe to modify
schema.$id; // "https://oatschema.org/0.8.0/classification"
SCHEMA_VERSION; // "0.8.0", used when you don't pass a version

isValid({ labels: [{ label: "cat", score: 0.92 }] }, "classification"); // true
validate({ labels: [{ label: "cat", score: 1.5 }] }, "classification");
// throws ValidationError: classification 0.8.0 at /labels/0/score: … is greater than the maximum of 1
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

`oatschema/validate` checks a record (a JSON value, such as the result of `JSON.parse`) against a bundled schema:

```ts
import { getValidator, isValid, iterErrors, validate, ValidationError } from "oatschema/validate";

const record = JSON.parse(text);
if (!isValid(record, "classification")) {
  for (const error of iterErrors(record, "classification")) {
    console.log(error.path, error.keyword, error.reason); // ["labels", 0, "score"] "maximum" "… is greater than the maximum of 1"
  }
}

try {
  validate(record, "classification", "0.8.0");
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.message); // classification 0.8.0 at /labels/0/score: … is greater than the maximum of 1
  }
}

const validator = getValidator("classification"); // cached, so get it once and reuse it
validator.isValid(record);
```

- `validate` throws a `ValidationError` for the first error. `iterErrors` yields every error, and `isValid` returns a boolean.
- Formats (`date-time` and `uri`) are checked unless you pass `{ checkFormats: false }`, as in `isValid(record, "classification", undefined, { checkFormats: false })`.
- Pass the schema version a record was written for. A version read from a record is a `string`; narrow it with `isSchemaVersion(version)` first.

**Errors never quote the record.** A `ValidationError` shows each value from the record as `…` and quotes only property names, so a multi-megabyte value can't end up in a log. `reason` is at most 1,000 characters, each string in `path` at most 100, and `message` adds the schema, version and location. It has:

| Property | Holds |
| :--- | :--- |
| `message` | `classification 0.8.0 at /labels/0/score: … is greater than the maximum of 1` |
| `reason` | `… is greater than the maximum of 1` |
| `path` | `["labels", 0, "score"]`: where in the record, with array indices as numbers |
| `keyword` | `"maximum"`: the JSON Schema keyword that rejected the value |
| `schemaPath` | `["properties", "labels", "items", "properties", "score", "maximum"]`: where in the schema |
| `schemaName`, `schemaVersion` | The schema it was checked against |

### One schema only

`oatschema/validate` loads the validators for every schema (about 56 KB gzipped). A page that checks one schema can load just that one, plus about 7 KB of shared code:

```ts
import { getValidator } from "oatschema/validate/document-extraction";

const validator = getValidator(); // or getValidator("0.8.0", { checkFormats: false })
validator.validate(record);
```

### In a browser, without a bundler

Every module in `dist/` imports only other files in `dist/` by relative path, and nothing evaluates code from strings. Serve the package's `dist/` directory from your own origin and import the file you need:

```html
<script type="module">
  import { getValidator } from "/static/oatschema/dist/validate/classification.js";
  getValidator().isValid({ labels: [{ label: "cat" }] });
</script>
```

### Same verdicts as oatschema-py

The validators are compiled from the schemas with [Ajv](https://ajv.js.org), but no Ajv code or type is part of the API. The repository's `conformance/` directory holds every example from each bundled OATS release, with its expected verdict, plus format edge cases checked against the jsonschema-rs version oatschema-py uses. The tests check every case here, and a script checks the same cases against oatschema-py. They agree on all of them, with format checks on and off.

`date-time` follows RFC 3339 strictly (a `T` separator, an offset with a colon, real dates, and leap seconds only at 23:59:60 UTC), and `uri` accepts any absolute RFC 3986 URI, including `x:`. Both match jsonschema-rs on every case in `conformance/formats.json`.

Known differences from oatschema-py:

- **One changes a verdict:** JavaScript numbers hold integers exactly only up to 2^53. `JSON.parse` rounds larger ones, so two different large integers in a `uniqueItems` list (such as `embedding`'s sparse `indices` or `document-extraction`'s page lists) can become equal and fail here while oatschema-py accepts them. Keep such integers below 9007199254740992.

These don't change a verdict:

- Property names in messages are shortened to 100 characters. oatschema-py quotes them in full, within its 1,000-character limit.
- When a record has several errors, the two packages may list them in a different order, so `validate` can report a different one of them.
- Records must be JSON values. Values JSON can't hold, such as `undefined`, `NaN`, functions, class instances and cyclic objects, give no particular result.

### With your own Ajv

If you already compile schemas with Ajv, `oatschema/ajv` registers the two OATS keywords and the same `date-time` and `uri` checks:

```ts
import { Ajv2020 } from "ajv/dist/2020.js";
import { getSchema } from "oatschema";
import { addOatsFormats, addOatsKeywords } from "oatschema/ajv";

const ajv = new Ajv2020({ allErrors: true, strictTypes: false, strictTuples: false, strictRequired: false });
addOatsFormats(addOatsKeywords(ajv));
const check = ajv.compile(getSchema("classification"));
```

- `x-license` and `x-version` are the only non-standard keywords in OATS. Registering them keeps Ajv's strict mode on for everything else.
- The three relaxed options switch off Ajv's style checks, which reject some valid 2020-12 patterns that OATS uses, such as `required` inside an `if`.
- Compile each schema once per Ajv instance and reuse the function. Compiling a second copy with the same `$id` throws; fetch the first with `ajv.getSchema(schema.$id)`.
- Ajv's own error objects can carry property names from the record at any length. `oatschema/validate` bounds its errors; with your own Ajv, that's up to you.

## API

From `oatschema`:

| Export | Description |
| :--- | :--- |
| `getSchema(name, version?)` | The schema as a new object on every call |
| `getSchemaJson(name, version?)` | The schema file's text, exactly as released |
| `availableVersions()` | Every bundled schema version, oldest first |
| `SCHEMA_VERSION` | The default schema version, the newest bundled |
| `SCHEMA_NAMES`, `SchemaName` | The schema names, as an array and a union type |
| `SchemaVersion`, `isSchemaVersion(value)` | The bundled versions as a union type, and a guard that narrows a string to it |
| `UnknownSchemaError` | Thrown for a name that exists in no bundled version |
| `SchemaLookupError` | Thrown for a version that isn't bundled, or that lacks the schema |

From `oatschema/validate`:

| Export | Description |
| :--- | :--- |
| `validate(record, name, version?, options?)` | Throws a `ValidationError` for the first error |
| `isValid(record, name, version?, options?)` | Whether the record conforms |
| `iterErrors(record, name, version?, options?)` | An iterator over every error |
| `getValidator(name, version?, options?)` | A cached `Validator` with `validate`, `isValid` and `iterErrors` methods |
| `ValidationError` | A record that doesn't conform |

`oatschema/validate` also re-exports `UnknownSchemaError` and `SchemaLookupError`, and the types `Validator`, `ValidateOptions` and `ValidationErrorDetails`. `oatschema/validate/<name>` exports `getValidator(version?, options?)` for that schema, `ValidationError`, `SchemaLookupError` and the same types. `oatschema/ajv` exports `addOatsKeywords(ajv)` and `addOatsFormats(ajv)`.

- `version` must be exact: `"0.8.0"`, never `"0.8"` or `"latest"`.
- `options` is `{ checkFormats?: boolean }`. Any other key, or a `checkFormats` that isn't a boolean, throws a `TypeError`.
- `UnknownSchemaError` and `SchemaLookupError` carry the requested `schemaName`, and `SchemaLookupError` also carries `schemaVersion`.

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

The precompiled validators in `dist/compiled/` are generated by Ajv, which is MIT-licensed; its licence is in `THIRD-PARTY-NOTICES`.
