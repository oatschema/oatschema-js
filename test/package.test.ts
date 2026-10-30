// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(PROJECT, "package.json"), "utf8"));
const NAMES = JSON.parse(readFileSync(join(PROJECT, "schemas", "0.8.0", "MANIFEST.json"), "utf8")).files as Record<
  string,
  string
>;

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

test("npm pack includes exactly the intended files", () => {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const output = execFileSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: PROJECT,
    encoding: "utf8",
  });
  const [packed] = JSON.parse(output) as [{ files: { path: string }[] }];
  const names = Object.keys(NAMES).map((file) => file.slice(0, -".json".length));
  const modules = ["ajv", "bundled", "errors", "formats", "index", "names", "validate", "validation"];
  assert.deepEqual(
    packed.files.map((file) => file.path).sort(),
    [
      "AUTHORS",
      "CHANGELOG.md",
      "LICENSE",
      "README.md",
      "THIRD-PARTY-NOTICES",
      "package.json",
      "dist/compiled/index.js",
      ...modules.flatMap((module) => [`dist/${module}.d.ts`, `dist/${module}.js`]),
      ...names.map((name) => `dist/compiled/0.8.0/${name}.js`),
      ...names.flatMap((name) => [`dist/validate/${name}.d.ts`, `dist/validate/${name}.js`]),
    ].sort(),
  );
});

test("package.json declares an ESM-only package with no runtime dependencies", () => {
  assert.equal(pkg.name, "oatschema");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.sideEffects, false);
  assert.equal(pkg.license, "Apache-2.0");
  assert.equal(pkg.author, "OATS maintainers <maintainers@oatschema.org>");
  assert.equal(pkg.engines.node, ">=22");
  assert.deepEqual(pkg.exports, {
    ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    "./validate": { types: "./dist/validate.d.ts", default: "./dist/validate.js" },
    "./validate/*": { types: "./dist/validate/*.d.ts", default: "./dist/validate/*.js" },
    "./ajv": { types: "./dist/ajv.d.ts", default: "./dist/ajv.js" },
    "./package.json": "./package.json",
  });
  assert.equal(pkg.types, "./dist/index.d.ts");
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.peerDependencies, undefined);
  assert.equal(pkg.optionalDependencies, undefined);
  assert.equal(pkg.bundleDependencies, undefined);
  assert.equal(pkg.devDependencies.ajv, "8.20.0");
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test("the built package's declarations import nothing outside itself", () => {
  for (const file of walk(join(PROJECT, "dist")).filter((name) => name.endsWith(".d.ts"))) {
    const source = readFileSync(file, "utf8");
    const specifiers = [...source.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      assert.match(specifier ?? "", /^\.{1,2}\/[\w./-]+\.[jt]s$/, `${file} imports ${specifier}`);
      const target = join(dirname(file), (specifier ?? "").replace(/\.[jt]s$/, ".d.ts"));
      assert.ok(target.startsWith(join(PROJECT, "dist")) && statSync(target).isFile(), `${file} imports ${specifier}`);
    }
    if (!file.endsWith("ajv.d.ts")) {
      assert.doesNotMatch(
        source,
        /\bajv\b|ErrorObject|instancePath|params|Compiled(?:Validator|Versions|Table)|COMPILED|versionValidator|tableValidator/,
        relative(PROJECT, file),
      );
    }
  }
});

test("the built package carries the OATS licence header and no legacy references", () => {
  for (const file of walk(join(PROJECT, "dist"))) {
    const source = readFileSync(file, "utf8");
    const name = relative(PROJECT, file);
    assert.doesNotMatch(source, /dorsal/i, name);
    if (!name.endsWith(".js")) {
      continue;
    }
    assert.ok(source.startsWith("// SPDX-FileCopyrightText: 2026 The OATS Authors\n"), name);
    if (name.startsWith("dist/compiled/") && name !== "dist/compiled/index.js") {
      assert.ok(source.includes("\n// SPDX-License-Identifier: Apache-2.0 AND MIT\n"), name);
    } else {
      assert.ok(source.includes("\n// SPDX-License-Identifier: Apache-2.0\n"), name);
    }
  }
});

test("the third-party notices carry Ajv's licence", () => {
  const notices = readFileSync(join(PROJECT, "THIRD-PARTY-NOTICES"), "utf8");
  const ajvLicense = readFileSync(join(PROJECT, "node_modules", "ajv", "LICENSE"), "utf8");
  assert.ok(notices.includes(ajvLicense.trim()));
  assert.ok(notices.includes(`ajv ${pkg.devDependencies.ajv}`));
});

test("every source file starts with the SPDX header", () => {
  const sources = [
    ...["src", "scripts", "test"].flatMap((directory) =>
      walk(join(PROJECT, directory))
        .filter((file) => /\.(?:[cm]?[jt]s|py)$/.test(file))
        .map((file) => [relative(PROJECT, file), file.endsWith(".py") ? "#" : "//"]),
    ),
    ...readdirSync(join(PROJECT, ".github", "workflows")).map((file) => [join(".github", "workflows", file), "#"]),
  ];
  assert.ok(sources.length > 0);
  for (const [path = "", marker = ""] of sources) {
    const header = `${marker} SPDX-FileCopyrightText: 2026 The OATS Authors\n${marker} SPDX-License-Identifier: Apache-2.0\n`;
    assert.ok(readFileSync(join(PROJECT, path), "utf8").startsWith(header), path);
  }
});
