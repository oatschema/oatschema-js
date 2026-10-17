// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(PROJECT, "package.json"), "utf8"));
const jsr = JSON.parse(readFileSync(join(PROJECT, "jsr.json"), "utf8"));

test("npm pack includes exactly the intended files", () => {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const output = execFileSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: PROJECT,
    encoding: "utf8",
  });
  const [packed] = JSON.parse(output) as [{ files: { path: string }[] }];
  assert.deepEqual(packed.files.map((file) => file.path).sort(), [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "dist/bundled.d.ts",
    "dist/bundled.js",
    "dist/index.d.ts",
    "dist/index.js",
    "package.json",
  ]);
});

test("package.json declares an ESM-only package with no runtime dependencies", () => {
  assert.equal(pkg.name, "oatschema");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.sideEffects, false);
  assert.equal(pkg.license, "Apache-2.0");
  assert.equal(pkg.author, "OATS maintainers <maintainers@oatschema.org>");
  assert.equal(pkg.engines.node, ">=22");
  assert.deepEqual(pkg.exports["."], { types: "./dist/index.d.ts", default: "./dist/index.js" });
  assert.equal(pkg.types, "./dist/index.d.ts");
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.peerDependencies, undefined);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test("jsr.json matches package.json", () => {
  assert.equal(jsr.version, pkg.version);
  assert.equal(jsr.license, pkg.license);
  assert.equal(jsr.exports, "./src/index.ts");
});

test("the built package imports nothing outside itself", () => {
  const dist = join(PROJECT, "dist");
  for (const file of readdirSync(dist).filter((name) => name.endsWith(".js"))) {
    const source = readFileSync(join(dist, file), "utf8");
    const specifiers = [...source.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      assert.match(specifier ?? "", /^\.\/[\w.-]+\.js$/, `${file} imports ${specifier}`);
    }
    assert.doesNotMatch(source, /\b(?:require|process|Buffer|__dirname)\b/, file);
  }
});

test("the built package carries the OATS licence header and no legacy references", () => {
  const dist = join(PROJECT, "dist");
  for (const file of readdirSync(dist)) {
    const source = readFileSync(join(dist, file), "utf8");
    if (file.endsWith(".js")) {
      assert.ok(source.startsWith("// SPDX-FileCopyrightText: 2026 The OATS Authors\n"), file);
    }
    assert.doesNotMatch(source, /dorsal/i, file);
  }
});

test("every source file starts with the SPDX header", () => {
  const sources = [
    ...["src", "scripts", "test"].flatMap((directory) =>
      readdirSync(join(PROJECT, directory))
        .filter((file) => /\.[cm]?[jt]s$/.test(file))
        .map((file) => [join(directory, file), "//"]),
    ),
    ...readdirSync(join(PROJECT, ".github", "workflows")).map((file) => [join(".github", "workflows", file), "#"]),
  ];
  assert.ok(sources.length > 0);
  for (const [path = "", marker = ""] of sources) {
    const header = `${marker} SPDX-FileCopyrightText: 2026 The OATS Authors\n${marker} SPDX-License-Identifier: Apache-2.0\n`;
    assert.ok(readFileSync(join(PROJECT, path), "utf8").startsWith(header), path);
  }
});
