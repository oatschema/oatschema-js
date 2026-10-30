// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { getSchema, SchemaLookupError, type SchemaName, UnknownSchemaError } from "oatschema";
import { getValidator, iterErrors, ValidationError, validate } from "oatschema/validate";

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CASES = JSON.parse(readFileSync(join(PROJECT, "conformance", "0.8.0", "cases.json"), "utf8")) as {
  cases: { file: string; schema: SchemaName; valid: boolean }[];
};
const BIG = "x".repeat(4 * 1024 * 1024);
const BIG_KEY = `k${"é".repeat(4 * 1024 * 1024)}`;
const HOSTILE = "y".repeat(1024 * 1024);
const HOSTILE_KEY = `k${"é".repeat(1024 * 1024)}`;
const MANY_KEYS = Object.fromEntries(
  Array.from({ length: 300 }, (_, index) => [`${HOSTILE_KEY.slice(0, 1000)}${index}`, index]),
);
const LEAK = /x{101}|y{101}|é{101}/;
const REASON_LIMIT = 1000;
const MESSAGE_LIMIT = 2300;
const STACK_LIMIT = 8000;
const NON_FAILING = new Set([
  "$id",
  "$schema",
  "$defs",
  "$ref",
  "allOf",
  "additionalItems",
  "description",
  "else",
  "if",
  "items",
  "patternProperties",
  "prefixItems",
  "properties",
  "propertyNames",
  "then",
  "title",
  "x-license",
  "x-version",
]);

const FOLDED = new Set(["if", "anyOf", "oneOf", "contains"]);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function record(file: string): Json {
  return JSON.parse(readFileSync(join(PROJECT, "conformance", "0.8.0", file), "utf8")) as Json;
}

function assertBounded(error: unknown): asserts error is ValidationError {
  assert.ok(error instanceof ValidationError, `not a ValidationError: ${String(error).slice(0, 200)}`);
  assert.ok(error.reason.length <= REASON_LIMIT, `reason is ${error.reason.length} characters`);
  assert.ok(error.message.length <= MESSAGE_LIMIT, `message is ${error.message.length} characters`);
  assert.ok(String(error).length <= MESSAGE_LIMIT + 20, `String(error) is ${String(error).length} characters`);
  assert.ok((error.stack ?? "").length <= STACK_LIMIT, `stack is ${(error.stack ?? "").length} characters`);
  assert.ok(JSON.stringify(error).length <= STACK_LIMIT, `JSON is ${JSON.stringify(error).length} characters`);
  assert.ok(error.keyword.length <= 100);
  for (const part of [...error.path, ...error.schemaPath]) {
    assert.ok(typeof part === "number" || part.length <= 100, `path part is ${String(part).length} characters`);
  }
  assert.doesNotMatch(error.message, LEAK);
  assert.doesNotMatch(JSON.stringify(error.path), LEAK);
  assert.ok(!("cause" in error));
}

function* locations(value: Json, path: (string | number)[] = []): Generator<(string | number)[]> {
  yield path;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      yield* locations(value[index] as Json, [...path, index]);
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      yield* locations(child, [...path, key]);
    }
  }
}

function replaced(value: Json, path: readonly (string | number)[], replacement: (old: Json) => Json): Json {
  if (path.length === 0) {
    return replacement(value);
  }
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    const copy = [...value];
    copy[head as number] = replaced(copy[head as number] as Json, rest, replacement);
    return copy;
  }
  const copy = { ...(value as { [key: string]: Json }) };
  copy[head as string] = replaced(copy[head as string] as Json, rest, replacement);
  return copy;
}

const MUTATIONS: readonly ((old: Json) => Json)[] = [
  () => HOSTILE,
  () => [HOSTILE, HOSTILE],
  () => ({ [HOSTILE_KEY]: HOSTILE }),
  () => MANY_KEYS,
  () => 0,
  () => 1e308,
  () => -1e308,
  () => null,
  (old) =>
    old !== null && typeof old === "object" && !Array.isArray(old)
      ? { ...old, [HOSTILE_KEY]: { [HOSTILE_KEY]: HOSTILE } }
      : old,
  (old) => (Array.isArray(old) ? [...old, ...old] : old),
  (old) => (Array.isArray(old) ? [] : old),
  (old) => (old !== null && typeof old === "object" && !Array.isArray(old) ? {} : old),
  (old) => (old !== null && typeof old === "object" && !Array.isArray(old) ? { ...old, ...MANY_KEYS } : old),
];

function assertionKeywords(schema: unknown, hidden = false, found = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) {
    for (const item of schema) {
      assertionKeywords(item, hidden, found);
    }
  } else if (schema !== null && typeof schema === "object") {
    for (const [key, value] of Object.entries(schema)) {
      if (!hidden && !NON_FAILING.has(key)) {
        found.add(key);
      }
      if (["enum", "const", "required", "x-license", "description", "title", "pattern", "format"].includes(key)) {
        continue;
      }
      if (["properties", "$defs", "patternProperties"].includes(key)) {
        for (const child of Object.values(value as object)) {
          assertionKeywords(child, hidden, found);
        }
      } else {
        assertionKeywords(value, hidden || FOLDED.has(key), found);
      }
    }
  }
  return found;
}

describe("every error is bounded, whatever the record holds", () => {
  const seen = new Set<string>();
  const used = new Set<string>();
  const seeds = CASES.cases.filter((item) => item.valid);
  for (const name of new Set(seeds.map((item) => item.schema))) {
    for (const keyword of assertionKeywords(getSchema(name))) {
      used.add(keyword);
    }
  }

  for (const seed of seeds) {
    test(`hostile variants of ${seed.file}`, () => {
      const base = record(seed.file);
      const variants: Json[] = [HOSTILE, [HOSTILE], { [HOSTILE_KEY]: HOSTILE }];
      for (const path of locations(base)) {
        for (const mutate of MUTATIONS) {
          variants.push(replaced(base, path, mutate));
        }
      }
      for (const checkFormats of [true, false]) {
        const validator = getValidator(seed.schema, undefined, { checkFormats });
        for (const variant of variants) {
          let count = 0;
          for (const error of validator.iterErrors(variant)) {
            assertBounded(error);
            seen.add(error.keyword);
            count++;
          }
          try {
            validator.validate(variant);
            assert.equal(count, 0);
            assert.ok(validator.isValid(variant));
          } catch (error) {
            assertBounded(error);
            assert.ok(count > 0);
            assert.ok(!validator.isValid(variant));
          }
        }
      }
    });
  }

  test("the hostile variants reach every keyword the schemas can fail on", () => {
    assert.ok(used.has("maxLength") && used.has("additionalProperties") && used.has("maxProperties"));
    const missing = [...used].filter((keyword) => !seen.has(keyword)).sort();
    assert.deepEqual(missing, []);
  });
});

describe("multi-megabyte values and keys, keyword by keyword", () => {
  const cases: [string, SchemaName, Json, string][] = [
    ["maxLength", "classification", { labels: [{ label: BIG }] }, "maxLength"],
    ["type", "classification", { labels: [{ label: "cat", score: BIG }] }, "type"],
    ["enum", "document-extraction", { unit: BIG, blocks: [] }, "enum"],
    [
      "const",
      "geolocation",
      { type: BIG, geometry: { type: "Point", coordinates: [0, 0] }, properties: null },
      "const",
    ],
    ["pattern", "audio-transcription", { text: "hi", language: `${BIG}` }, "pattern"],
    ["format", "classification", { labels: [{ label: "cat" }], vocabulary_url: `x${BIG} ` }, "format"],
    ["additionalProperties", "classification", { labels: [{ label: "cat" }], [BIG_KEY]: BIG }, "additionalProperties"],
    ["propertyNames", "generic", { data: { [BIG_KEY]: BIG } }, "maxLength"],
    ["anyOf", "generic", { data: { key: { [BIG_KEY]: BIG } } }, "anyOf"],
    ["oneOf", "document-extraction", { unit: "pt", page_width: BIG, blocks: [] }, "oneOf"],
    ["uniqueItems", "classification", { labels: [{ label: "cat" }], vocabulary: [BIG, BIG] }, "uniqueItems"],
  ];
  for (const [title, name, value, keyword] of cases) {
    test(title, () => {
      const errors = [...iterErrors(value, name)];
      assert.ok(
        errors.some((error) => error.keyword === keyword),
        errors.map((error) => error.keyword).join(", "),
      );
      for (const error of errors) {
        assertBounded(error);
      }
      assert.throws(
        () => validate(value, name),
        (error) => {
          assertBounded(error);
          return true;
        },
      );
    });
  }

  test("a multi-megabyte key in a path is shortened", () => {
    const errors = [...iterErrors({ data: { [BIG_KEY]: { nested: true } } }, "generic")];
    assert.ok(errors.length > 0);
    for (const error of errors) {
      assertBounded(error);
    }
    assert.ok(errors.some((error) => error.path.some((part) => typeof part === "string" && part.endsWith("…"))));
  });

  test("many unexpected properties are listed within the bound", () => {
    const extra = Object.fromEntries(
      Array.from({ length: 5000 }, (_, index) => [`${BIG_KEY.slice(0, 200)}${index}`, 1]),
    );
    const errors = [...iterErrors({ labels: [{ label: "cat" }], ...extra }, "classification")];
    assert.equal(errors.length, 1);
    assertBounded(errors[0]);
    assert.ok(errors[0]?.reason.endsWith("…"));
  });
});

describe("other errors are bounded", () => {
  test("lookup and option errors", () => {
    const attempts: (() => unknown)[] = [
      () => validate({}, BIG as SchemaName),
      () => validate({}, "classification", BIG as "0.8.0"),
      () => validate({}, "classification", undefined, { checkFormats: BIG as unknown as boolean }),
      () => validate({}, "classification", undefined, { [BIG]: true } as object),
      () => getSchema(BIG as SchemaName),
      () => getSchema("classification", BIG as "0.8.0"),
      () => new ValidationError(BIG, { schemaName: BIG as SchemaName, schemaVersion: BIG as "0.8.0", path: [BIG] }),
    ];
    for (const attempt of attempts) {
      let caught: unknown;
      try {
        caught = attempt();
      } catch (error) {
        caught = error;
      }
      assert.ok(caught instanceof Error);
      assert.ok(
        caught instanceof UnknownSchemaError ||
          caught instanceof SchemaLookupError ||
          caught instanceof TypeError ||
          caught instanceof ValidationError,
      );
      assert.ok(caught.message.length <= MESSAGE_LIMIT, `${caught.name} message is ${caught.message.length}`);
      assert.ok((caught.stack ?? "").length <= STACK_LIMIT);
      assert.ok(
        JSON.stringify(caught).length <= STACK_LIMIT,
        `${caught.name} JSON is ${JSON.stringify(caught).length}`,
      );
    }
  });
});
