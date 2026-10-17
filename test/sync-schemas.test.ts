// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  checkName,
  checkSchema,
  duplicateKeys,
  expectedId,
  METASCHEMA,
  parseTag,
  SyncError,
  sha256,
  sync,
} from "../scripts/sync-schemas.ts";

function schemaBytes(name: string, version: string, overrides: Record<string, unknown> = {}): Uint8Array {
  const schema = {
    "x-license": LICENSE,
    $schema: METASCHEMA,
    $id: expectedId(name, parseTag(`v${version}`)),
    title: name,
    "x-version": version,
    type: "object",
    ...overrides,
  };
  return new TextEncoder().encode(JSON.stringify(schema, null, 2));
}

const LICENSE = {
  id: "Apache-2.0",
  notice: "Copyright 2025-2026 The OATS Authors",
  url: "https://github.com/oatschema/oats/blob/main/LICENSE",
};

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

describe("parseTag", () => {
  for (const tag of ["0.8.0", "v0.8", "v0.8.0-rc1", "latest", "v0.7.0", "v0.4.0", "v0.7.99"]) {
    test(`rejects ${tag}`, () => {
      assert.throws(() => parseTag(tag), SyncError);
    });
  }

  test("parses a release tag", () => {
    assert.deepEqual(parseTag("v0.8.0"), [0, 8, 0]);
    assert.deepEqual(parseTag("v0.10.2"), [0, 10, 2]);
    assert.deepEqual(parseTag("v1.0.0"), [1, 0, 0]);
  });

  test("names the first bundled release when refusing an older tag", () => {
    assert.throws(() => parseTag("v0.7.0"), /older than v0\.8\.0/);
  });
});

test("expectedId includes the version", () => {
  assert.equal(expectedId("generic", [0, 8, 0]), "https://oatschema.org/0.8.0/generic");
  assert.equal(expectedId("generic", [1, 0, 0]), "https://oatschema.org/1.0.0/generic");
});

describe("checkName", () => {
  for (const name of ["docs", "latest", "changelog", "3d-detection", "Generic", "llm_output", "a--b", "-a"]) {
    test(`rejects ${name}`, () => {
      assert.throws(() => checkName(name), SyncError);
    });
  }
});

describe("duplicateKeys", () => {
  test("finds duplicates at any depth", () => {
    assert.deepEqual(duplicateKeys('{"a": 1, "b": {"c": 1, "c": 2}, "a": [{"d": 1}, {"d": 2}]}'), ["a", "c"]);
  });

  test("ignores keys in separate objects and string values that look like keys", () => {
    assert.deepEqual(duplicateKeys('{"a": "a", "b": ["a", "a"], "c": {"a": {}}, "d": "\\"a\\""}'), []);
  });
});

describe("checkSchema", () => {
  test("accepts a release schema", () => {
    checkSchema("generic", schemaBytes("generic", "0.8.0"), [0, 8, 0]);
    checkSchema("generic", schemaBytes("generic", "1.2.3"), [1, 2, 3]);
  });

  test("accepts any year range in the notice", () => {
    for (const notice of ["Copyright 2025 The OATS Authors", "Copyright 2025-2031 The OATS Authors"]) {
      checkSchema("generic", schemaBytes("generic", "0.8.0", { "x-license": { ...LICENSE, notice } }), [0, 8, 0]);
    }
  });

  const cases: [string, Uint8Array, RegExp][] = [
    ["wrong x-version", schemaBytes("generic", "0.8.0", { "x-version": "0.7.0" }), /x-version/],
    ["a missing x-version", schemaBytes("generic", "0.8.0", { "x-version": undefined }), /x-version is undefined/],
    ["a top-level version", schemaBytes("generic", "0.8.0", { version: "0.8.0" }), /top-level version/],
    ["an older $id", schemaBytes("generic", "0.8.0", { $id: "https://oatschema.org/0.7.0/generic" }), /\$id/],
    ["draft-07", schemaBytes("generic", "0.8.0", { $schema: "http://json-schema.org/draft-07/schema#" }), /\$schema/],
    ["a missing x-license", schemaBytes("generic", "0.8.0", { "x-license": undefined }), /x-license is undefined/],
    ["another licence", schemaBytes("generic", "0.8.0", { "x-license": { ...LICENSE, id: "MIT" } }), /x-license\.id/],
    [
      "another copyright holder",
      schemaBytes("generic", "0.8.0", { "x-license": { ...LICENSE, notice: "Copyright 2025-2026 Someone Else" } }),
      /x-license\.notice/,
    ],
    ["duplicate keys", new TextEncoder().encode('{"x-version": "0.8.0", "x-version": "0.8.0"}'), /duplicate keys/],
    ["array", new TextEncoder().encode("[]"), /not a JSON object/],
    ["truncated", new TextEncoder().encode("{"), /invalid JSON/],
    ["byte order mark", new Uint8Array([0xef, 0xbb, 0xbf, ...schemaBytes("generic", "0.8.0")]), /invalid JSON/],
    ["not UTF-8", new Uint8Array([...new TextEncoder().encode('{"title": "'), 0xff, 0x22, 0x7d]), /not UTF-8/],
  ];
  for (const [label, data, message] of cases) {
    test(`rejects ${label}`, () => {
      assert.throws(
        () => checkSchema("generic", data, [0, 8, 0]),
        (error: unknown) => {
          return error instanceof SyncError && message.test(error.message);
        },
      );
    });
  }
});

describe("sync", () => {
  let root: string;
  let repo: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "oatschema-sync-"));
    const origin = join(root, "origin.git");
    repo = join(root, "oats");
    execFileSync("git", ["init", "--bare", "-q", origin]);
    execFileSync("git", ["init", "-q", repo]);
    git(repo, "config", "user.email", "test@example.com");
    git(repo, "config", "user.name", "Test");
    git(repo, "config", "commit.gpgsign", "false");
    git(repo, "config", "tag.gpgsign", "false");
    git(repo, "remote", "add", "origin", origin);
    mkdirSync(join(repo, "schemas"));
    for (const name of ["classification", "temporal-segmentation"]) {
      writeFileSync(join(repo, "schemas", `${name}.json`), schemaBytes(name, "0.8.0"));
    }
    writeFileSync(join(repo, "schemas", "README.md"), "not a schema\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "release");
    git(repo, "tag", "-a", "v0.8.0", "-m", "v0.8.0");
    git(repo, "push", "-q", "origin", "HEAD", "--tags");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("copies the tag byte for byte", () => {
    const dest = join(root, "schemas");
    writeFileSync(join(repo, "schemas", "classification.json"), "working tree edit\n");
    const target = sync(repo, "v0.8.0", dest);
    assert.equal(target, join(dest, "0.8.0"));
    assert.deepEqual(readdirSync(target).sort(), [
      "MANIFEST.json",
      "classification.json",
      "temporal-segmentation.json",
    ]);
    const original = schemaBytes("classification", "0.8.0");
    assert.deepEqual(new Uint8Array(readFileSync(join(target, "classification.json"))), original);
    const manifest = JSON.parse(readFileSync(join(target, "MANIFEST.json"), "utf8"));
    assert.equal(manifest.tag, "v0.8.0");
    assert.equal(manifest.commit, git(repo, "rev-parse", "v0.8.0^{commit}").trim());
    assert.equal(manifest.files["classification.json"], sha256(original));
    assert.deepEqual(readdirSync(dest), ["0.8.0"]);
  });

  test("refuses a release older than 0.8.0 before reading it", () => {
    git(repo, "tag", "-a", "v0.7.0", "-m", "v0.7.0");
    git(repo, "push", "-q", "origin", "--tags");
    const dest = join(root, "schemas");
    assert.throws(() => sync(repo, "v0.7.0", dest), /older than v0\.8\.0/);
    assert.ok(!existsSync(dest));
  });

  test("refuses an existing version", () => {
    const dest = join(root, "schemas");
    mkdirSync(join(dest, "0.8.0"), { recursive: true });
    assert.throws(() => sync(repo, "v0.8.0", dest), /never rewritten/);
  });

  test("refuses an unpushed tag", () => {
    git(repo, "tag", "v0.8.1");
    assert.throws(() => sync(repo, "v0.8.1", join(root, "schemas")), /not been pushed/);
  });

  test("refuses a moved tag", () => {
    git(repo, "commit", "-q", "--allow-empty", "-m", "later");
    git(repo, "tag", "-f", "-a", "v0.8.0", "-m", "moved");
    assert.throws(() => sync(repo, "v0.8.0", join(root, "schemas")), /on origin/);
  });

  test("writes nothing when a schema fails", () => {
    writeFileSync(join(repo, "schemas", "docs.json"), schemaBytes("docs", "0.8.1"));
    for (const name of ["classification", "temporal-segmentation"]) {
      writeFileSync(join(repo, "schemas", `${name}.json`), schemaBytes(name, "0.8.1"));
    }
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "bad release");
    git(repo, "tag", "-a", "v0.8.1", "-m", "v0.8.1");
    git(repo, "push", "-q", "origin", "--tags");
    const dest = join(root, "schemas");
    assert.throws(() => sync(repo, "v0.8.1", dest), /reserved/);
    assert.ok(!existsSync(dest));
  });
});
