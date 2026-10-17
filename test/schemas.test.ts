// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  availableVersions,
  getSchema,
  getSchemaJson,
  SCHEMA_NAMES,
  SCHEMA_VERSION,
  SchemaLookupError,
  type SchemaName,
  UnknownSchemaError,
} from "oatschema";

describe("constants", () => {
  test("SCHEMA_VERSION is the newest bundled version", () => {
    assert.equal(SCHEMA_VERSION, availableVersions().at(-1));
  });

  test("availableVersions lists every bundled version oldest first", () => {
    assert.deepEqual(availableVersions(), ["0.8.0"]);
  });

  test("availableVersions returns a new array", () => {
    const versions = availableVersions();
    versions.pop();
    assert.deepEqual(availableVersions(), ["0.8.0"]);
  });

  test("constants cannot be modified", () => {
    assert.ok(Object.isFrozen(SCHEMA_NAMES));
    assert.throws(() => (SCHEMA_NAMES as unknown as string[]).push("x"), TypeError);
  });
});

describe("getSchema", () => {
  test("defaults to SCHEMA_VERSION", () => {
    assert.deepEqual(getSchema("classification"), getSchema("classification", SCHEMA_VERSION));
    assert.equal(getSchema("classification")["x-version"], SCHEMA_VERSION);
  });

  test("reads the requested version", () => {
    const schema = getSchema("ranking", "0.8.0");
    assert.equal(schema["x-version"], "0.8.0");
    assert.equal(schema.$id, "https://oatschema.org/0.8.0/ranking");
  });

  test("returns independent deep copies", () => {
    const first = getSchema("classification");
    const properties = first.properties as Record<string, unknown>;
    for (const key of Object.keys(properties)) {
      delete properties[key];
    }
    first.title = "changed";
    const second = getSchema("classification");
    assert.ok(Object.keys(second.properties as object).length > 0);
    assert.notEqual(second.title, "changed");
    assert.notEqual(second, getSchema("classification"));
    assert.notEqual(second.properties, getSchema("classification").properties);
  });

  for (const name of ["classifications", "open/classification", "", "MANIFEST", "constructor", "__proto__"]) {
    test(`rejects unknown name ${JSON.stringify(name)}`, () => {
      assert.throws(() => getSchema(name as SchemaName), UnknownSchemaError);
      assert.throws(() => getSchema(name as SchemaName), /unknown schema name/);
    });
  }

  for (const name of [undefined, null, 42, {}]) {
    test(`rejects non-string name ${String(name)}`, () => {
      assert.throws(() => getSchema(name as unknown as SchemaName), UnknownSchemaError);
    });
  }

  for (const version of [
    "0.8",
    "latest",
    "v0.8.0",
    "0.8.0.0",
    "0.7.0",
    "0.4.0",
    "9.9.9",
    "",
    "constructor",
    "__proto__",
  ]) {
    test(`rejects inexact or unbundled version ${JSON.stringify(version)}`, () => {
      assert.throws(() => getSchema("classification", version), SchemaLookupError);
      assert.throws(() => getSchema("classification", version), /is not bundled/);
    });
  }

  test("rejects a non-string version", () => {
    assert.throws(() => getSchema("classification", 0.8 as unknown as string), SchemaLookupError);
    assert.throws(() => getSchema("classification", null as unknown as string), SchemaLookupError);
  });

  test("an unknown name wins over an unknown version", () => {
    assert.throws(() => getSchema("nope" as SchemaName, "9.9.9"), UnknownSchemaError);
  });

  test("errors are distinct and carry what was requested", () => {
    let caught: unknown;
    try {
      getSchema("nope" as SchemaName);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof UnknownSchemaError);
    assert.ok(!(caught instanceof SchemaLookupError));
    assert.equal(caught.name, "UnknownSchemaError");
    assert.equal(caught.schemaName, "nope");
    assert.ok(caught.message.includes("ranking, regression, temporal-segmentation"));
    try {
      getSchema("classification", "0.8");
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof SchemaLookupError);
    assert.ok(!(caught instanceof UnknownSchemaError));
    assert.equal(caught.name, "SchemaLookupError");
    assert.equal(caught.schemaName, "classification");
    assert.equal(caught.schemaVersion, "0.8");
    assert.ok(caught.message.endsWith("available: 0.8.0"));
  });
});

describe("getSchemaJson", () => {
  test("returns the released text, which parses to getSchema's result", () => {
    const text = getSchemaJson("classification", "0.8.0");
    assert.equal(typeof text, "string");
    assert.deepEqual(JSON.parse(text), getSchema("classification", "0.8.0"));
  });

  test("defaults to SCHEMA_VERSION", () => {
    assert.equal(getSchemaJson("classification"), getSchemaJson("classification", SCHEMA_VERSION));
  });

  test("reports name and version errors like getSchema", () => {
    assert.throws(() => getSchemaJson("nope" as SchemaName), UnknownSchemaError);
    assert.throws(() => getSchemaJson("classification", "0.8"), SchemaLookupError);
    assert.throws(() => getSchemaJson("classification", "0.7.0"), SchemaLookupError);
  });
});
