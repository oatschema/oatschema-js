// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  availableVersions,
  getSchema,
  getSchemaJson,
  SCHEMA_NAMES,
  SCHEMA_VERSION,
  type SchemaName,
  type SchemaVersion,
} from "oatschema";
import { DEFAULT_OUTPUT, render } from "../scripts/generate.ts";
import {
  checkSchema,
  MANIFEST_NAME,
  METASCHEMA,
  parseTag,
  DEFAULT_DEST as SCHEMAS_DIR,
  sha256,
} from "../scripts/sync-schemas.ts";

const OATS_REPO = process.env.OATS_REPO || join(homedir(), "projects", "oats");
const RESERVED_NAMES = new Set(["changelog", "docs", "latest"]);

function bundledNames(version: string): string[] {
  return readdirSync(join(SCHEMAS_DIR, version))
    .filter((file) => file.endsWith(".json") && file !== MANIFEST_NAME)
    .map((file) => file.slice(0, -".json".length))
    .sort();
}

function allSchemas(): [SchemaVersion, SchemaName][] {
  return availableVersions().flatMap((version) =>
    bundledNames(version).map((name): [SchemaVersion, SchemaName] => [version, name as SchemaName]),
  );
}

describe("bundled files", () => {
  test("availableVersions matches the bundled directories", () => {
    const directories = readdirSync(SCHEMAS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    assert.deepEqual(new Set(availableVersions()), new Set(directories));
    assert.equal(availableVersions()[0], "0.8.0");
  });

  test("SCHEMA_NAMES matches SCHEMA_VERSION and covers older versions", () => {
    assert.deepEqual([...SCHEMA_NAMES], bundledNames(SCHEMA_VERSION));
    for (const version of availableVersions()) {
      for (const name of bundledNames(version)) {
        assert.ok((SCHEMA_NAMES as readonly string[]).includes(name), `${version}/${name}`);
      }
    }
  });

  test("names are servable", () => {
    for (const name of SCHEMA_NAMES) {
      assert.match(name, /^[a-z]/);
      assert.ok(!RESERVED_NAMES.has(name));
    }
  });

  for (const version of availableVersions()) {
    test(`${version} matches its manifest`, () => {
      const manifest = JSON.parse(readFileSync(join(SCHEMAS_DIR, version, MANIFEST_NAME), "utf8"));
      assert.equal(manifest.tag, `v${version}`);
      assert.match(manifest.commit, /^[0-9a-f]{40}$/);
      const actual = Object.fromEntries(
        readdirSync(join(SCHEMAS_DIR, version))
          .filter((file) => file !== MANIFEST_NAME)
          .map((file) => [file, sha256(readFileSync(join(SCHEMAS_DIR, version, file)))]),
      );
      assert.deepEqual(actual, manifest.files);
    });
  }

  test("src/bundled.ts is up to date with the bundled files", () => {
    assert.equal(readFileSync(DEFAULT_OUTPUT, "utf8"), render());
  });
});

describe("embedded schemas", () => {
  for (const [version, name] of allSchemas()) {
    test(`${version}/${name} is embedded byte for byte`, () => {
      const released = readFileSync(join(SCHEMAS_DIR, version, `${name}.json`));
      assert.deepEqual(Buffer.from(new TextEncoder().encode(getSchemaJson(name, version))), released);
    });

    test(`${version}/${name} has the expected identity`, () => {
      const schema = getSchema(name, version);
      assert.equal(schema["x-version"], version);
      assert.ok(!Object.hasOwn(schema, "version"));
      assert.equal(schema.$schema, METASCHEMA);
      assert.equal(schema.$id, `https://oatschema.org/${version}/${name}`);
      checkSchema(name, readFileSync(join(SCHEMAS_DIR, version, `${name}.json`)), parseTag(`v${version}`));
    });
  }
});

describe("release tags", {
  skip: existsSync(join(OATS_REPO, ".git")) ? false : "set OATS_REPO to a checkout of oats",
}, () => {
  for (const version of availableVersions()) {
    test(`${version} is byte-identical to v${version} in oats`, () => {
      const manifest = JSON.parse(readFileSync(join(SCHEMAS_DIR, version, MANIFEST_NAME), "utf8"));
      const commit = spawnSync("git", ["-C", OATS_REPO, "rev-parse", `v${version}^{commit}`], { encoding: "utf8" });
      assert.equal(commit.stdout.trim(), manifest.commit);
      const listing = spawnSync("git", ["-C", OATS_REPO, "ls-tree", "--name-only", `v${version}:schemas`], {
        encoding: "utf8",
      });
      const files = listing.stdout.split("\n").filter((file) => file.endsWith(".json"));
      assert.deepEqual(files.sort(), Object.keys(manifest.files).sort());
      for (const file of files) {
        const released = spawnSync("git", ["-C", OATS_REPO, "show", `v${version}:schemas/${file}`], {
          maxBuffer: 64 * 1024 * 1024,
        });
        assert.equal(released.status, 0);
        assert.deepEqual(readFileSync(join(SCHEMAS_DIR, version, file)), released.stdout, file);
        const name = file.slice(0, -".json".length) as SchemaName;
        const text = getSchemaJson(name, version as SchemaVersion);
        assert.deepEqual(Buffer.from(new TextEncoder().encode(text)), released.stdout, file);
      }
    });
  }
});
