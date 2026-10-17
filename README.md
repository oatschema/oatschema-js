# oatschema

The OATS (Open Annotation Task Schemas) JSON schemas, bundled for JavaScript and TypeScript: strict, versioned schemas for the outputs of machine learning models, workflows and human annotation. OATS is unrelated to the W3C Web Annotation data model, formerly Open Annotation.

Schemas, documentation and the changelog live at [oatschema.org](https://oatschema.org). The schemas are maintained in [oatschema/oats](https://github.com/oatschema/oats); this package bundles them unchanged. For Python, see [oatschema-python](https://github.com/oatschema/oatschema-python).

- ESM only, with TypeScript types.
- No runtime dependencies, and no file or network access: the schemas are embedded in the package, so it works the same in Node.js 22+, browsers, Deno, Bun and bundlers.

## Install

```
npm install oatschema
```

## Usage

```ts
import { getSchema, getSchemaJson, SCHEMA_VERSION, availableVersions } from "oatschema";

const schema = getSchema("classification"); // a plain object, for any validator or tool
const pinned = getSchema("classification", "0.8.0"); // an exact bundled version
const text = getSchemaJson("classification"); // the schema file exactly as released

SCHEMA_VERSION; // "0.8.0", the default version
availableVersions(); // ["0.8.0"]
schema["x-version"]; // "0.8.0", the OATS release the schema belongs to
```

- `getSchema` returns a new object on every call, so you can change it without affecting other callers.
- `SCHEMA_NAMES` lists the schema names in `SCHEMA_VERSION`, and `SchemaName` is their union type.
- An unknown schema name throws `UnknownSchemaError`. A version that isn't bundled, or doesn't contain that schema, throws `SchemaLookupError`. Both carry the requested `schemaName`, and `SchemaLookupError` also carries `schemaVersion`.

This release has no validator of its own. To validate now, pass a schema to any JSON Schema 2020-12 validator, for example [Ajv](https://ajv.js.org):

```ts
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { getSchema } from "oatschema";

const ajv = new Ajv2020({ allErrors: true, strictTypes: false, strictTuples: false, strictRequired: false });
ajv.addKeyword({ keyword: "x-license", schemaType: "object" });
ajv.addKeyword({ keyword: "x-version", schemaType: "string" });
addFormats(ajv);
const validate = ajv.compile(getSchema("classification"));
```

- OATS schemas carry two annotation keywords, `x-license` and `x-version`. Register them as above, so Ajv's strict mode still rejects any other unknown keyword.
- The three relaxed options turn off Ajv-specific style checks that go beyond JSON Schema. OATS schemas use patterns those checks reject, such as `required` inside an `if` condition, while staying valid 2020-12. Leaving them on makes some schemas fail to compile.
- Compile each schema once per Ajv instance and reuse the function. Ajv registers a schema by its `$id`, so compiling a second copy from `getSchema` throws; use `ajv.getSchema("https://oatschema.org/0.8.0/classification")` to fetch one compiled earlier.

## Schema versions

Every function takes an optional `version`, which defaults to `SCHEMA_VERSION`, the newest bundled version. Versions must be exact, such as `"0.8.0"`; `"0.8"` and `"latest"` are rejected.

`availableVersions()` lists every bundled version, oldest first. Before 1.0.0, a schema version may reject records that an older one accepted, so validate a record against the version it was written for.

Each schema's `$id` includes its version (`https://oatschema.org/0.8.0/classification`), so several versions can sit side by side in one JSON Schema registry. A schema's own version is in its `x-version` keyword.

This package bundles OATS 0.8.0, the first public release, and every later release. [oatschema-python](https://github.com/oatschema/oatschema-python) also bundles the earlier releases, 0.4.0 to 0.7.0, which carry their version in a `version` keyword instead of `x-version`.

## Package versions

The package uses its own semantic version, independent of the OATS schema versions. The package version never encodes a schema version: read `SCHEMA_VERSION` to see which OATS release is the default.

- Every package release bundles every earlier schema version too, so upgrading never removes a version you validate against.
- Before 1.0, a release that bundles a new OATS version, and so changes the default `SCHEMA_VERSION`, is a minor bump (`0.1.x` to `0.2.0`). Fixes and additions that keep the same default are patch releases.
- npm's default caret range (`^0.1.0`, which means `>=0.1.0 <0.2.0`) therefore keeps the default schema version fixed. Pass an explicit `version` to stay on one schema version across upgrades.

## License

Apache-2.0. See [LICENSE](LICENSE).
