// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as schemas from "oatschema";
import { isSchemaVersion, SCHEMA_NAMES, SCHEMA_VERSION, type SchemaName, type SchemaVersion } from "oatschema";
import * as validation from "oatschema/validate";
import {
  getValidator,
  isValid,
  iterErrors,
  SchemaLookupError,
  UnknownSchemaError,
  ValidationError,
  validate,
} from "oatschema/validate";
import * as classification from "oatschema/validate/classification";

const VALID = { labels: [{ label: "cat", score: 0.9, timestamp: "2026-10-20T12:00:00Z" }] };
const BAD_SCORE = { labels: [{ label: "cat", score: 1.5 }] };
const BAD_DATE = { labels: [{ label: "cat", timestamp: "2026-10-20 12:00:00Z" }] };

function caught(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  assert.fail("nothing was thrown");
}

describe("validate, isValid and iterErrors", () => {
  test("a conforming record", () => {
    assert.equal(validate(VALID, "classification"), undefined);
    assert.equal(isValid(VALID, "classification"), true);
    assert.deepEqual([...iterErrors(VALID, "classification")], []);
  });

  test("a non-conforming record", () => {
    const error = caught(() => validate(BAD_SCORE, "classification"));
    assert.ok(error instanceof ValidationError);
    assert.ok(error instanceof Error);
    assert.equal(error.name, "ValidationError");
    assert.equal(error.schemaName, "classification");
    assert.equal(error.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(error.path, ["labels", 0, "score"]);
    assert.deepEqual(error.schemaPath, ["properties", "labels", "items", "properties", "score", "maximum"]);
    assert.equal(error.keyword, "maximum");
    assert.equal(error.reason, "… is greater than the maximum of 1");
    assert.equal(error.message, "classification 0.8.0 at /labels/0/score: … is greater than the maximum of 1");
    assert.equal(String(error), `ValidationError: ${error.message}`);
    assert.ok(error.stack?.startsWith(`ValidationError: ${error.message}\n`));
    assert.ok(Object.isFrozen(error.path));
    assert.equal(isValid(BAD_SCORE, "classification"), false);
  });

  test("validate throws the first error iterErrors yields", () => {
    const record = { labels: [{ label: 7, score: 2 }], vocabulary: "x" };
    const errors = [...iterErrors(record, "classification")];
    assert.ok(errors.length >= 3);
    const first = caught(() => validate(record, "classification"));
    assert.ok(first instanceof ValidationError);
    assert.equal(first.message, errors[0]?.message);
  });

  test("iterErrors returns a fresh iterator of ValidationErrors", () => {
    const errors = iterErrors({ labels: "x", extra: 1 }, "classification");
    assert.equal(typeof errors.next, "function");
    assert.equal(errors[Symbol.iterator](), errors);
    const all = [...errors];
    assert.ok(all.length >= 2);
    assert.ok(all.every((error) => error instanceof ValidationError));
    assert.deepEqual([...errors], []);
  });

  test("the root is reported as /", () => {
    const error = caught(() => validate([], "classification"));
    assert.ok(error instanceof ValidationError);
    assert.deepEqual(error.path, []);
    assert.equal(error.message, 'classification 0.8.0 at /: … is not of type "object"');
  });

  test("array indices are numbers and object keys are strings, even when they look like numbers", () => {
    const errors = [...iterErrors({ data: { "0": [1] } }, "generic")];
    assert.deepEqual(errors[0]?.path, ["data", "0"]);
    const escaped = [...iterErrors({ data: { "a/b~c": [1] } }, "generic")];
    assert.deepEqual(escaped[0]?.path, ["data", "a/b~c"]);
  });

  test("a failed anyOf is reported once, without its branches", () => {
    const errors = [...iterErrors({ data: { nested: { a: 1 } } }, "generic")];
    assert.deepEqual(
      errors.map((error) => [error.path, error.keyword]),
      [[["data", "nested"], "anyOf"]],
    );
    assert.equal(errors[0]?.reason, "… is not valid under any of the schemas listed in the 'anyOf' keyword");
  });

  test("a failed oneOf is reported once, without its branches", () => {
    const errors = [...iterErrors({ unit: "pt", page_width: "wide", blocks: [] }, "document-extraction")];
    assert.deepEqual(
      errors.map((error) => [error.path, error.keyword]),
      [[["page_width"], "oneOf"]],
    );
  });

  test("an if/then failure reports the then error, not the if", () => {
    const record = { blocks: [{ block_type: "box", box: { x: 0, y: 0, width: 1, height: 1 } }] };
    const errors = [...iterErrors(record, "document-extraction")];
    assert.ok(errors.length > 0);
    assert.ok(errors.every((error) => error.keyword !== "if"));
    assert.ok(errors.some((error) => error.reason === '"unit" is a required property'));
  });

  test("a long property name breaking propertyNames is quoted, shortened, at the object", () => {
    const key = "k".repeat(200);
    const errors = [...iterErrors({ data: { [key]: 1 } }, "generic")];
    assert.equal(errors.length, 1);
    assert.deepEqual(errors[0]?.path, ["data"]);
    assert.equal(errors[0]?.keyword, "maxLength");
    assert.equal(errors[0]?.reason, `"${"k".repeat(99)}…" is longer than 128 characters`);
  });

  test("unexpected properties are listed in one error", () => {
    const errors = [...iterErrors({ ...VALID, one: 1, two: 2 }, "classification")];
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.reason, "Additional properties are not allowed ('one', 'two' were unexpected)");
    const single = [...iterErrors({ ...VALID, one: 1 }, "classification")];
    assert.equal(single[0]?.reason, "Additional properties are not allowed ('one' was unexpected)");
  });

  test("messages never show values from the record", () => {
    const secret = "s3cret-value";
    const record = {
      labels: [{ label: secret.repeat(100), score: secret, timestamp: secret }],
      vocabulary: [secret, secret],
      vocabulary_url: `${secret} x`,
    };
    const errors = [...iterErrors(record, "classification")];
    assert.ok(errors.length >= 4);
    for (const error of errors) {
      assert.ok(!error.message.includes(secret), error.message);
    }
  });

  test("records are only read", () => {
    const record = structuredClone(BAD_SCORE);
    Object.freeze(record.labels[0]);
    Object.freeze(record.labels);
    Object.freeze(record);
    assert.equal(isValid(record, "classification"), false);
    assert.deepEqual(record, BAD_SCORE);
  });

  test("inherited properties do not count", () => {
    const record = Object.create({ labels: [{ label: "cat" }] });
    assert.equal(isValid(record, "classification"), false);
    assert.equal(isValid({ labels: [{ label: "cat" }], __proto__: null }, "classification"), true);
    assert.equal(isValid(JSON.parse('{"labels": [{"label": "cat"}], "__proto__": {}}'), "classification"), false);
  });
});

describe("checkFormats", () => {
  test("formats are checked by default", () => {
    assert.equal(isValid(BAD_DATE, "classification"), false);
    const error = caught(() => validate(BAD_DATE, "classification"));
    assert.ok(error instanceof ValidationError);
    assert.equal(error.keyword, "format");
    assert.equal(error.reason, '… is not a "date-time"');
  });

  test("checkFormats: false skips them", () => {
    assert.equal(isValid(BAD_DATE, "classification", undefined, { checkFormats: false }), true);
    assert.deepEqual([...iterErrors(BAD_DATE, "classification", SCHEMA_VERSION, { checkFormats: false })], []);
    validate(BAD_DATE, "classification", undefined, { checkFormats: false });
  });

  test("the setting is part of the cache key", () => {
    const checked = getValidator("classification");
    const unchecked = getValidator("classification", undefined, { checkFormats: false });
    assert.notEqual(checked, unchecked);
    assert.equal(checked.checkFormats, true);
    assert.equal(unchecked.checkFormats, false);
    assert.equal(getValidator("classification", SCHEMA_VERSION, {}), checked);
    assert.equal(getValidator("classification", undefined, { checkFormats: true }), checked);
  });

  test("the setting holds while another validator runs inside a record's getter", () => {
    const unchecked = getValidator("classification", undefined, { checkFormats: false });
    const checked = getValidator("classification");
    const label = {
      label: "cat",
      get timestamp() {
        assert.equal(checked.isValid(BAD_DATE), false);
        return "not a date";
      },
    };
    assert.equal(unchecked.isValid({ labels: [label] }), true);
    assert.equal(checked.isValid({ labels: [{ label: "cat", timestamp: "not a date" }] }), false);
  });

  test("the setting is restored when validation throws", () => {
    const unchecked = getValidator("classification", undefined, { checkFormats: false });
    const label = {
      label: "cat",
      get score(): number {
        throw new RangeError("boom");
      },
    };
    assert.throws(() => unchecked.isValid({ labels: [label] }), RangeError);
    assert.equal(isValid(BAD_DATE, "classification"), false);
  });

  for (const options of [null, 1, "x", true, [], () => undefined]) {
    test(`options ${String(options)} is rejected`, () => {
      assert.throws(() => getValidator("classification", undefined, options as object), TypeError);
    });
  }

  for (const checkFormats of [0, 1, "false", "true", null]) {
    test(`checkFormats ${JSON.stringify(checkFormats)} is rejected`, () => {
      const options = { checkFormats } as unknown as { checkFormats: boolean };
      assert.throws(() => getValidator("classification", undefined, options), /checkFormats must be true or false/);
      assert.throws(() => isValid(VALID, "classification", undefined, options), TypeError);
    });
  }

  test("an unknown option is rejected", () => {
    const options = { checkFormat: false } as unknown as { checkFormats: boolean };
    assert.throws(() => validate(VALID, "classification", undefined, options), /unknown option "checkFormat"/);
  });
});

describe("getValidator", () => {
  test("returns a cached, frozen validator", () => {
    const validator = getValidator("classification");
    assert.equal(getValidator("classification", SCHEMA_VERSION), validator);
    assert.equal(validator.schemaName, "classification");
    assert.equal(validator.schemaVersion, SCHEMA_VERSION);
    assert.ok(Object.isFrozen(validator));
    assert.equal(Object.prototype.toString.call(validator), "[object Validator classification 0.8.0]");
    assert.equal(validator.isValid(VALID), true);
    assert.throws(() => validator.validate(BAD_SCORE), ValidationError);
    assert.equal([...validator.iterErrors(BAD_SCORE)].length, 1);
  });

  test("covers every schema", () => {
    for (const name of SCHEMA_NAMES) {
      assert.equal(getValidator(name).schemaName, name);
      assert.equal(isValid(null, name), false);
    }
  });

  for (const name of ["classifications", "", "constructor", "__proto__", "MANIFEST", 7, null, undefined]) {
    test(`rejects the name ${String(name)}`, () => {
      assert.throws(() => getValidator(name as SchemaName), UnknownSchemaError);
      assert.throws(() => validate({}, name as SchemaName), UnknownSchemaError);
    });
  }

  for (const version of ["0.8", "latest", "v0.8.0", "0.7.0", "9.9.9", "", "__proto__", 0.8, null]) {
    test(`rejects the version ${String(version)}`, () => {
      assert.throws(() => getValidator("classification", version as SchemaVersion), SchemaLookupError);
      assert.throws(() => getValidator("classification", version as SchemaVersion), /is not bundled/);
    });
  }

  test("checks the options before the name, as oatschema-py does", () => {
    assert.throws(() => getValidator("nope" as SchemaName, undefined, { checkFormats: 1 } as object), TypeError);
  });
});

describe("entry points", () => {
  test("oatschema/validate/<name> shares validators and errors with oatschema/validate", () => {
    assert.equal(classification.getValidator(), getValidator("classification"));
    assert.equal(
      classification.getValidator(undefined, { checkFormats: false }),
      getValidator("classification", undefined, { checkFormats: false }),
    );
    assert.equal(classification.ValidationError, ValidationError);
    assert.equal(classification.SchemaLookupError, schemas.SchemaLookupError);
    assert.equal(validation.SchemaLookupError, schemas.SchemaLookupError);
    assert.equal(validation.UnknownSchemaError, schemas.UnknownSchemaError);
    assert.throws(() => classification.getValidator("0.7.0" as SchemaVersion), SchemaLookupError);
    assert.throws(() => classification.getValidator(undefined, { checkFormats: "no" } as object), TypeError);
  });

  test("the public modules export exactly the documented names", () => {
    assert.deepEqual(Object.keys(validation).sort(), [
      "SchemaLookupError",
      "UnknownSchemaError",
      "ValidationError",
      "getValidator",
      "isValid",
      "iterErrors",
      "validate",
    ]);
    assert.deepEqual(Object.keys(classification).sort(), ["SchemaLookupError", "ValidationError", "getValidator"]);
    assert.deepEqual(Object.keys(schemas).sort(), [
      "SCHEMA_NAMES",
      "SCHEMA_VERSION",
      "SchemaLookupError",
      "UnknownSchemaError",
      "availableVersions",
      "getSchema",
      "getSchemaJson",
      "isSchemaVersion",
    ]);
  });
});

describe("isSchemaVersion", () => {
  test("accepts exactly the bundled versions", () => {
    for (const version of schemas.availableVersions()) {
      assert.equal(isSchemaVersion(version), true);
    }
    for (const value of ["0.8", "0.7.0", "latest", "", " 0.8.0", "0.8.0 ", 0.8, null, undefined, {}, ["0.8.0"]]) {
      assert.equal(isSchemaVersion(value), false, String(value));
    }
  });

  test("narrows a string for the type checker", () => {
    const fromRecord: string = "0.8.0";
    if (isSchemaVersion(fromRecord)) {
      const version: SchemaVersion = fromRecord;
      assert.equal(getValidator("classification", version).schemaVersion, "0.8.0");
    } else {
      assert.fail("0.8.0 is bundled");
    }
    const plain = String(fromRecord);
    // @ts-expect-error
    assert.equal(getValidator("classification", plain).schemaVersion, "0.8.0");
  });
});
