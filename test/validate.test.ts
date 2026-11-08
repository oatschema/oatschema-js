// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
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
    assert.equal(error.message, "classification 0.9.0 at /labels/0/score: … is greater than the maximum of 1");
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
    assert.equal(error.message, 'classification 0.9.0 at /: … is not of type "object"');
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
    assert.equal(Object.prototype.toString.call(validator), "[object Validator classification 0.9.0]");
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

describe("schema versions", () => {
  const SEED = { model: "m", response_data: "x", generation_params: { seed: 42 } };
  const STRING_SEED = { model: "m", response_data: "x", generation_params: { seed: "42" } };

  test("a version is a literal of the union", () => {
    const newest: SchemaVersion = "0.9.0";
    const older: SchemaVersion = "0.8.0";
    assert.equal(isSchemaVersion(newest), true);
    assert.equal(isSchemaVersion(older), true);
    // @ts-expect-error
    const unbundled: SchemaVersion = "0.7.0";
    assert.equal(isSchemaVersion(unbundled), false);
  });

  test("no version means 0.9.0, and each version keeps its own rules", () => {
    assert.equal(isValid(SEED, "llm-output"), false);
    assert.equal(isValid(STRING_SEED, "llm-output"), true);
    assert.equal(isValid(SEED, "llm-output", "0.9.0"), false);
    assert.equal(isValid(SEED, "llm-output", "0.8.0"), true);
    assert.equal(isValid(STRING_SEED, "llm-output", "0.8.0"), false);
    const [error] = iterErrors(SEED, "llm-output");
    assert.equal(error?.schemaVersion, "0.9.0");
    assert.deepEqual(error?.path, ["generation_params", "seed"]);
  });

  for (const name of SCHEMA_NAMES) {
    test(`oatschema/validate/${name} serves every bundled version`, async () => {
      const entry = (await import(`oatschema/validate/${name}`)) as typeof classification;
      assert.equal(entry.getValidator().schemaVersion, SCHEMA_VERSION);
      for (const version of schemas.availableVersions()) {
        assert.equal(entry.getValidator(version).schemaVersion, version);
        assert.equal(entry.getValidator(version), getValidator(name, version));
      }
    });
  }

  for (const version of schemas.availableVersions()) {
    test(`a repeated __proto__ fails uniqueItems at ${version}`, () => {
      const record = (vocabulary: string[]): unknown => ({ labels: [], vocabulary });
      assert.equal(isValid(record(["__proto__", "__proto__"]), "classification", version), false);
      assert.equal(isValid(record(["__proto__", "a"]), "classification", version), true);
      const [error] = iterErrors(record(["__proto__", "__proto__"]), "classification", version);
      assert.equal(error?.keyword, "uniqueItems");
      assert.deepEqual(error?.path, ["vocabulary"]);
    });
  }

  test("large integers keep their documented results at 0.8.0, and are rejected at 0.9.0", () => {
    const sparse = (indices: string): unknown =>
      JSON.parse(`{"model":"m","vector":{"dimensions":30522,"indices":${indices},"values":[1,2]}}`);
    assert.equal(isValid(sparse("[1,2]"), "embedding", "0.8.0"), true);
    assert.equal(isValid(sparse("[9007199254740992,9007199254740994]"), "embedding", "0.8.0"), true);
    assert.equal(isValid(sparse("[9007199254740992,9007199254740993]"), "embedding", "0.8.0"), false);
    assert.equal(isValid(sparse("[9007199254740992,9007199254740994]"), "embedding", "0.9.0"), false);
    const infinite = JSON.parse(`{"results":[{"rank":1${"0".repeat(400)},"id":"a"}]}`);
    assert.equal(isValid(infinite, "ranking", "0.8.0"), false);
    assert.equal(isValid(infinite, "ranking", "0.9.0"), false);
    const beyond = JSON.parse('{"results":[{"rank":9007199254740993,"id":"a"}]}');
    assert.equal(isValid(beyond, "ranking", "0.8.0"), true);
    assert.equal(isValid(beyond, "ranking", "0.9.0"), false);
  });
});

describe("unpaired surrogates", () => {
  const LONE = ["\ud800", "\udbff", "\udc00", "\udfff", "\udc00\ud800", "a\ud83db", "\ud83d\ud83d\ude00"];
  const PAIRED = ["😀", "\ud83d\ude00", "a😀b", "\u{10ffff}"];
  const REASON = "… contains an unpaired surrogate, which RFC 7493 does not allow in JSON text";

  for (const version of schemas.availableVersions()) {
    for (const checkFormats of [true, false]) {
      const options = { checkFormats };

      test(`a string with one is invalid at ${version}, checkFormats ${checkFormats}`, () => {
        for (const text of LONE) {
          const record = { labels: [], producer: text };
          assert.equal(isValid(record, "classification", version, options), false);
          assert.equal(getValidator("classification", version, options).isValid(record), false);
          assert.equal(classification.getValidator(version, options).isValid(record), false);
          const error = caught(() => validate(record, "classification", version, options));
          assert.ok(error instanceof ValidationError);
          assert.deepEqual(error.path, ["producer"]);
          assert.equal(error.keyword, "");
          assert.deepEqual(error.schemaPath, []);
          assert.equal(error.reason, REASON);
          assert.deepEqual(
            [...iterErrors(record, "classification", version, options)].map((item) => item.message),
            [error.message],
          );
        }
      });

      test(`a property name with one is invalid at ${version}, checkFormats ${checkFormats}`, () => {
        for (const text of LONE) {
          const record = { labels: [], attributes: { [text]: "a" } };
          assert.equal(isValid(record, "classification", version, options), false);
          const [error] = iterErrors(record, "classification", version, options);
          assert.deepEqual(error?.path, ["attributes", text]);
        }
      });

      test(`paired surrogates stay valid at ${version}, checkFormats ${checkFormats}`, () => {
        for (const text of PAIRED) {
          for (const record of [
            { labels: [], producer: text },
            { labels: [], attributes: { [text]: text } },
            { labels: [], vocabulary: ["a", text] },
          ]) {
            assert.equal(isValid(record, "classification", version, options), true);
            assert.deepEqual([...iterErrors(record, "classification", version, options)], []);
            validate(record, "classification", version, options);
          }
        }
      });
    }
  }

  for (const name of SCHEMA_NAMES) {
    test(`every entry point of ${name} refuses one, however the record is shaped`, async () => {
      const entry = (await import(`oatschema/validate/${name}`)) as typeof classification;
      for (const version of schemas.availableVersions()) {
        for (const record of ["\ud800", ["\ud800"], { "\ud800": 1 }, { a: [{ b: "\ud800" }] }]) {
          assert.equal(entry.getValidator(version).isValid(record), false);
          assert.equal(isValid(record, name, version), false);
          assert.equal([...iterErrors(record, name, version)][0]?.keyword, "");
          assert.equal([...entry.getValidator(version).iterErrors(record)][0]?.keyword, "");
          const error = caught(() => validate(record, name, version));
          assert.ok(error instanceof ValidationError);
          assert.equal(error.keyword, "");
          const fromEntry = caught(() => entry.getValidator(version).validate(record));
          assert.ok(fromEntry instanceof ValidationError);
          assert.equal(fromEntry.keyword, "");
        }
      }
    });
  }

  test("iterErrors reports every surrogate and nothing else, in oatschema-py's order", () => {
    const record = {
      labels: "wrong",
      producer: "\ud800",
      vocabulary: ["a", "\udc00"],
      attributes: { "\ud801": "\ud802" },
    };
    assert.deepEqual(
      [...iterErrors(record, "classification")].map((error) => error.path),
      [["producer"], ["vocabulary", 1], ["attributes", "\ud801"], ["attributes", "\ud801"]],
    );
  });

  test("surrogates come in oatschema-py's order, so validate reports the same one", () => {
    const cases: [unknown, (string | number)[][]][] = [
      [
        { labels: [], attributes: { x: "\ud800" }, vocabulary: ["\udc00"], producer: "\udfff" },
        [["attributes", "x"], ["vocabulary", 0], ["producer"]],
      ],
      [
        { labels: [], attributes: { "a\ud800": "\udc00", b: "x", "c\ud800": "y" }, producer: "\ud800" },
        [["attributes", "c\ud800"], ["attributes", "a\ud800"], ["attributes", "a\ud800"], ["producer"]],
      ],
      [
        {
          labels: [{ label: "\ud800", x: { "\udc00": ["\ud800", { "k\ud800": 1 }] } }],
          "z\udfff": "\ud800",
          producer: "\ud800",
        },
        [
          ["z\udfff"],
          ["labels", 0, "label"],
          ["labels", 0, "x", "\udc00"],
          ["labels", 0, "x", "\udc00", 0],
          ["labels", 0, "x", "\udc00", 1, "k\ud800"],
          ["z\udfff"],
          ["producer"],
        ],
      ],
    ];
    for (const [record, paths] of cases) {
      assert.deepEqual(
        [...iterErrors(record, "classification")].map((error) => error.path),
        paths,
      );
      const error = caught(() => validate(record, "classification"));
      assert.ok(error instanceof ValidationError);
      assert.deepEqual(error.path, paths[0]);
    }
  });

  test("the message can always be printed, and stays bounded", () => {
    const [short] = iterErrors({ labels: [], attributes: { "\ud800": "a" } }, "classification");
    assert.equal(short?.message.isWellFormed(), true);
    assert.ok(short?.message.includes("attributes/\\ud800:"));
    const key = "\ud800".repeat(1024 * 1024);
    const [long] = iterErrors({ labels: [], attributes: { [key]: "a" } }, "classification");
    assert.ok(String(long?.path[1]).length <= 100);
    assert.ok((long?.message.length ?? 0) < 1300);
    assert.equal(long?.message.isWellFormed(), true);
  });

  test("a surrogate as deep as a record can validly go is found", () => {
    let deep: unknown = "\ud800";
    for (let level = 0; level < 50; level++) {
      deep = { a: deep };
    }
    const [error] = iterErrors({ labels: [], attributes: deep }, "classification");
    assert.equal(error?.keyword, "");
    assert.equal(error?.path.length, 51);
  });

  test("deep records stay cheap and invalid, with bounded errors", () => {
    const depth = 30_000;
    let nested: unknown = Array.from({ length: depth }, () => "\ud800");
    let chain: unknown = "\ud800";
    for (let level = 0; level < depth; level++) {
      nested = [nested];
      chain = { [`${"k".repeat(200)}\ud800`]: chain };
    }
    for (const record of [nested, { labels: [], x: nested }, { labels: [], x: chain }]) {
      const started = performance.now();
      assert.equal(isValid(record, "classification"), false);
      caught(() => validate(record, "classification"));
      const errors = [...iterErrors(record, "classification")];
      assert.ok(errors.length > 0);
      for (const error of errors) {
        assert.ok(error.path.length <= 66, String(error.path.length));
        assert.ok(error.message.length < 1300);
      }
      assert.ok(performance.now() - started < 30_000);
    }
  });

  test("cyclic and shared records finish, even past the point the scan starts tracking", () => {
    const cyclic: { labels: unknown[]; self?: unknown } = { labels: [] };
    cyclic.self = cyclic;
    assert.equal(isValid(cyclic, "classification"), false);
    const bad: { labels: unknown[]; self?: unknown; producer: string } = { labels: [], producer: "\ud800" };
    bad.self = bad;
    assert.equal([...iterErrors(bad, "classification")][0]?.keyword, "");
    let shared: unknown = "a";
    for (let level = 0; level < 200; level++) {
      shared = [shared, shared];
    }
    assert.equal(isValid({ labels: [], x: shared }, "classification"), false);
    const clean = { labels: [], producer: "ok", attributes: { a: "b" } };
    assert.equal(isValid(clean, "classification"), true);
  });
});

describe("records with more than 2^24 arrays and objects", () => {
  const COUNT = 2 ** 24 + 100;
  const REASON = "… contains an unpaired surrogate, which RFC 7493 does not allow in JSON text";

  test("get a verdict, with or without a surrogate, wherever it is", { timeout: 300_000 }, () => {
    const clean = Array.from({ length: COUNT }, () => []);
    assert.equal(isValid(clean, "classification"), false);
    assert.equal((caught(() => validate(clean, "classification")) as ValidationError).keyword, "type");
    assert.deepEqual(
      [...iterErrors(clean, "classification")].map((error) => error.keyword),
      ["type"],
    );
    const last = Array.from({ length: COUNT + 1 }, (_, index) => (index === COUNT ? "\ud800" : []));
    assert.equal(isValid(last, "classification"), false);
    assert.deepEqual((caught(() => validate(last, "classification")) as ValidationError).path, [COUNT]);
    assert.deepEqual(
      [...iterErrors(last, "classification")].map((error) => [error.path, error.reason]),
      [[[COUNT], REASON]],
    );
    const first = { labels: [], producer: "\ud800", x: clean };
    assert.equal(isValid(first, "classification"), false);
    assert.deepEqual((caught(() => validate(first, "classification")) as ValidationError).path, ["producer"]);
    assert.deepEqual(
      [...iterErrors(first, "classification")].map((error) => error.path),
      [["producer"]],
    );
  });

  test("a valid one stays valid", { timeout: 300_000 }, () => {
    const ring = (): number[][] => Array.from({ length: 8400 }, () => [0, 0]);
    const record = {
      type: "Feature",
      properties: {} as { [key: string]: string },
      geometry: { type: "MultiPolygon", coordinates: Array.from({ length: 1000 }, () => [ring(), ring()]) },
    };
    assert.equal(isValid(record, "geolocation"), true);
    validate(record, "geolocation");
    assert.deepEqual([...iterErrors(record, "geolocation")], []);
    record.properties.name = "\ud800";
    assert.equal(isValid(record, "geolocation"), false);
    assert.deepEqual(
      [...iterErrors(record, "geolocation")].map((error) => error.path),
      [["properties", "name"]],
    );
  });

  test("a surrogate needs no more heap than the clean record", { timeout: 300_000 }, () => {
    const script = `
      import { getValidator } from "oatschema/validate";
      const count = 10_000_000;
      const record = Array.from({ length: count + 1 }, (_, index) =>
        index === count && process.argv[1] === "surrogate" ? "\\ud800" : []);
      const validator = getValidator("classification");
      const result = [validator.isValid(record)];
      try { validator.validate(record); } catch (error) { result.push(error.path); }
      result.push([...validator.iterErrors(record)].length);
      console.log(JSON.stringify(result));
    `;
    const run = (kind: string): string => {
      const child = spawnSync(
        process.execPath,
        ["--max-old-space-size=450", "--input-type=module", "-e", script, kind],
        { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
      );
      assert.equal(child.status, 0, child.stderr.slice(-2000));
      return child.stdout.trim();
    };
    assert.equal(run("clean"), "[false,[],1]");
    assert.equal(run("surrogate"), "[false,[10000000],1]");
  });

  test("iterErrors finds surrogates as it yields them, so stopping early is cheap", { timeout: 300_000 }, () => {
    const script = `
      import { getValidator } from "oatschema/validate";
      const record = Array.from({ length: 10_000_000 }, () => "\\ud800");
      const validator = getValidator("classification");
      const iterator = validator.iterErrors(record);
      const result = [iterator.next().value.path, iterator.next().value.path];
      try { validator.validate(record); } catch (error) { result.push(error.path); }
      console.log(JSON.stringify(result));
    `;
    const child = spawnSync(process.execPath, ["--max-old-space-size=300", "--input-type=module", "-e", script], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr.slice(-2000));
    assert.equal(child.stdout.trim(), "[[0],[1],[0]]");
  });

  test("shared parts don't multiply the work or the errors", { timeout: 120_000 }, () => {
    let shared: unknown = "\ud800";
    for (let level = 0; level < 60; level++) {
      shared = [shared, shared];
    }
    const record = { labels: [], x: shared };
    assert.equal(isValid(record, "classification"), false);
    assert.equal((caught(() => validate(record, "classification")) as ValidationError).keyword, "");
    const errors = [...iterErrors(record, "classification")];
    assert.ok(errors.length > 0 && errors.length < 1000, String(errors.length));
    let large: unknown = Array.from({ length: 2 ** 23 }, () => []);
    for (let level = 0; level < 12; level++) {
      large = [large, large];
    }
    const started = performance.now();
    assert.equal(isValid({ labels: [], x: large }, "classification"), false);
    assert.equal([...iterErrors({ labels: [], x: large }, "classification")].length, 1);
    assert.ok(performance.now() - started < 20_000);
    let wide: unknown = "a";
    for (let level = 0; level < 60; level++) {
      wide = { a: wide, b: wide, c: [wide] };
    }
    assert.equal(isValid({ labels: [], x: wide }, "classification"), false);
    assert.deepEqual(
      [...iterErrors({ labels: [], x: wide }, "classification")].map((error) => error.keyword),
      ["additionalProperties"],
    );
  });
});

describe("very long strings", () => {
  for (const version of schemas.availableVersions()) {
    test(`a very long uri or date-time is invalid, not a crash, at ${version}`, () => {
      const uri = `x:${"a".repeat(10_000_000)}`;
      const url = { labels: [], vocabulary_url: uri };
      assert.equal(isValid(url, "classification", version), false);
      assert.equal(isValid(url, "classification", version, { checkFormats: false }), false);
      assert.ok([...iterErrors(url, "classification", version)].length > 0);
      const stamp = { labels: [{ label: "a", timestamp: "2".repeat(10_000_000) }] };
      assert.equal(isValid(stamp, "classification", version), false);
    });
  }
});
