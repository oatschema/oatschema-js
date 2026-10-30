// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { availableVersions, getSchema, SCHEMA_NAMES, type SchemaName, type SchemaVersion } from "oatschema";
import { addOatsFormats, addOatsKeywords } from "oatschema/ajv";
import { isValid } from "oatschema/validate";
import { CASES_NAME, type Cases, DEFAULT_CORPUS } from "../scripts/corpus.ts";

function strictAjv(): InstanceType<typeof Ajv2020.default> {
  return new Ajv2020.default({ allErrors: true, strictTypes: false, strictTuples: false, strictRequired: false });
}

describe("metaschema", () => {
  for (const version of availableVersions()) {
    for (const name of SCHEMA_NAMES) {
      test(`${version}/${name} is a valid JSON Schema 2020-12 schema`, () => {
        const ajv = addOatsKeywords(strictAjv());
        const schema = getSchema(name, version);
        assert.equal(ajv.validateSchema(schema), true, JSON.stringify(ajv.errors));
        assert.equal(typeof addOatsFormats(ajv).compile(schema), "function");
      });
    }
  }

  test("strict mode rejects the schemas without the OATS keywords", () => {
    assert.throws(() => strictAjv().compile(getSchema("classification")), /x-license/);
  });
});

describe("bring your own Ajv", () => {
  test("the helpers return the instance they were given", () => {
    const ajv = strictAjv();
    assert.equal(addOatsKeywords(ajv), ajv);
    assert.equal(addOatsFormats(ajv), ajv);
  });

  for (const version of availableVersions()) {
    test(`runtime Ajv with the OATS helpers gives the same verdicts as oatschema/validate on the ${version} corpus`, () => {
      const data = JSON.parse(readFileSync(`${DEFAULT_CORPUS}/${version}/${CASES_NAME}`, "utf8")) as Cases;
      const ajv = addOatsFormats(addOatsKeywords(strictAjv()));
      for (const item of data.cases) {
        const name = item.schema as SchemaName;
        const record = JSON.parse(readFileSync(`${DEFAULT_CORPUS}/${version}/${item.file}`, "utf8"));
        const schema = getSchema(name, version as SchemaVersion);
        const compiled = ajv.getSchema(String(schema.$id)) ?? ajv.compile(schema);
        assert.equal(compiled(record), item.valid, item.file);
        assert.equal(isValid(record, name, version as SchemaVersion), item.valid, item.file);
      }
    });
  }
});
