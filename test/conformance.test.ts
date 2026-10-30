// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { availableVersions, SCHEMA_NAMES, type SchemaName, type SchemaVersion } from "oatschema";
import { getValidator, iterErrors, ValidationError } from "oatschema/validate";
import { buildCorpus, CASES_NAME, type Cases, DEFAULT_CORPUS } from "../scripts/corpus.ts";
import { sha256 } from "../scripts/sync-schemas.ts";

const OATS_REPO = process.env.OATS_REPO || join(homedir(), "projects", "oats");

interface FormatCorpus {
  version: SchemaVersion;
  engine: string;
  records: { [format: string]: { schema: SchemaName; record: unknown; path: (string | number)[] } };
  cases: { format: string; value: string; valid: boolean }[];
}

function corpus(version: string): Cases {
  return JSON.parse(readFileSync(join(DEFAULT_CORPUS, version, CASES_NAME), "utf8")) as Cases;
}

function pointer(error: ValidationError): string {
  return error.path.map((part) => `/${part}`).join("");
}

function embed(template: FormatCorpus["records"][string], value: string): unknown {
  const record = structuredClone(template.record) as { [key: string]: unknown };
  let node: { [key: string | number]: unknown } = record;
  for (const part of template.path.slice(0, -1)) {
    node = node[part] as { [key: string | number]: unknown };
  }
  node[template.path.at(-1) as string | number] = value;
  return record;
}

describe("corpus files", () => {
  test("there is a corpus for every bundled version", () => {
    const directories = readdirSync(DEFAULT_CORPUS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    assert.deepEqual(directories.sort(), [...availableVersions()].sort());
  });

  for (const version of availableVersions()) {
    test(`${version} lists every file, with its hash`, () => {
      const data = corpus(version);
      assert.equal(data.tag, `v${version}`);
      const listed = data.cases.map((item) => item.file).sort();
      const onDisk = ["positive", "negative"].flatMap((kind) =>
        readdirSync(join(DEFAULT_CORPUS, version, kind)).map((file) => `${kind}/${file}`),
      );
      assert.deepEqual(listed, onDisk.sort());
      for (const item of data.cases) {
        assert.equal(sha256(readFileSync(join(DEFAULT_CORPUS, version, item.file))), item.sha256, item.file);
        assert.ok((SCHEMA_NAMES as readonly string[]).includes(item.schema), item.file);
        assert.equal(item.version, version);
        assert.equal(item.valid, item.file.startsWith("positive/"));
      }
    });
  }
});

describe("oatschema/validate agrees with the corpus", () => {
  for (const version of availableVersions()) {
    for (const item of corpus(version).cases) {
      test(`${version} ${item.file}`, () => {
        const record = JSON.parse(readFileSync(join(DEFAULT_CORPUS, version, item.file), "utf8"));
        const name = item.schema as SchemaName;
        const withFormats = getValidator(name, version, { checkFormats: true });
        const withoutFormats = getValidator(name, version, { checkFormats: false });
        assert.equal(withFormats.isValid(record), item.valid);
        assert.equal(withoutFormats.isValid(record), item.valid_without_formats);
        const errors = [...iterErrors(record, name, version)];
        assert.equal(errors.length === 0, item.valid);
        if (item.error !== undefined) {
          const expected = item.error;
          const outside = errors.filter((error) => !`${pointer(error)}/`.startsWith(`${expected.path}/`));
          assert.deepEqual(
            outside.map((error) => error.message),
            [],
          );
          assert.ok(
            errors.some((error) => error.reason.includes(expected.message)),
            errors.map((error) => error.reason).join("; "),
          );
          assert.throws(
            () => withFormats.validate(record),
            (error) => error instanceof ValidationError && `${pointer(error)}/`.startsWith(`${expected.path}/`),
          );
        } else {
          withFormats.validate(record);
        }
        for (const error of errors) {
          assert.ok(!["if", "propertyNames"].includes(error.keyword));
        }
      });
    }
  }
});

describe("format checks agree with jsonschema-rs", () => {
  const data = JSON.parse(readFileSync(join(DEFAULT_CORPUS, "formats.json"), "utf8")) as FormatCorpus;

  test("the corpus covers every format the schemas use", () => {
    assert.deepEqual(Object.keys(data.records).sort(), ["date-time", "uri"]);
    for (const format of Object.keys(data.records)) {
      const cases = data.cases.filter((item) => item.format === format);
      assert.ok(cases.some((item) => item.valid));
      assert.ok(cases.some((item) => !item.valid));
    }
  });

  for (const item of data.cases) {
    test(`${item.format} ${JSON.stringify(item.value)} is ${item.valid ? "valid" : "invalid"}`, () => {
      const template = data.records[item.format];
      assert.ok(template !== undefined);
      const record = embed(template, item.value);
      assert.equal(getValidator(template.schema, data.version).isValid(record), item.valid);
      assert.equal(getValidator(template.schema, data.version, { checkFormats: false }).isValid(record), true);
      if (!item.valid) {
        const [error] = iterErrors(record, template.schema, data.version);
        assert.equal(error?.keyword, "format");
        assert.deepEqual(error?.path, template.path);
        assert.equal(error?.reason, `… is not a "${item.format}"`);
      }
    });
  }
});

describe("release tags", {
  skip: existsSync(join(OATS_REPO, ".git")) ? false : "set OATS_REPO to a checkout of oats",
}, () => {
  for (const version of availableVersions()) {
    test(`the ${version} corpus is byte-identical to v${version} in oats`, () => {
      const localCommit = (repo: string, tag: string): string =>
        spawnSync("git", ["-C", repo, "rev-parse", `${tag}^{commit}`], { encoding: "utf8" }).stdout.trim();
      const { cases, files } = buildCorpus(OATS_REPO, `v${version}`, undefined, localCommit);
      assert.deepEqual(cases, corpus(version));
      for (const [file, data] of files) {
        assert.deepEqual(new Uint8Array(readFileSync(join(DEFAULT_CORPUS, version, file))), data, file);
      }
    });
  }
});
