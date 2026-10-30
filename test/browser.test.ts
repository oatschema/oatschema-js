// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { SCHEMA_NAMES } from "oatschema";

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(PROJECT, "dist");
const SHARED = ["errors.js", "formats.js", "names.js", "validation.js"];
const FORBIDDEN: readonly [RegExp, string][] = [
  [/\brequire\b/, "require"],
  [/\beval\b/, "eval"],
  [/\bFunction\s*\(/, "Function"],
  [/\bimport\s*\(/, "dynamic import"],
  [/\bimport\s*\.\s*meta\b/, "import.meta"],
  [/\b(?:process|Buffer|__dirname|__filename|module\.exports)\b/, "a Node.js global"],
  [/\bsetTimeout\s*\(\s*["'`]/, "setTimeout with a string"],
];

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function imports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/(?:\bfrom|\bimport)\s*["']([^"']+)["']/g)].map((match) => match[1] ?? "");
}

function graph(entry: string): Set<string> {
  const seen = new Set<string>();
  const pending = [resolve(DIST, entry)];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    for (const specifier of imports(file)) {
      pending.push(resolve(dirname(file), specifier));
    }
  }
  return new Set([...seen].map((file) => relative(DIST, file)));
}

describe("the shipped modules run as plain browser ESM under script-src 'self'", () => {
  const scripts = walk(DIST).filter((file) => file.endsWith(".js"));

  test("there are modules to check", () => {
    assert.ok(scripts.length >= 2 * SCHEMA_NAMES.length);
  });

  for (const file of scripts) {
    const name = relative(DIST, file);
    test(`${name} has no code generation, require or Node.js globals`, () => {
      const source = readFileSync(file, "utf8");
      for (const [pattern, what] of FORBIDDEN) {
        assert.doesNotMatch(source, pattern, `${name} uses ${what}`);
      }
    });

    test(`${name} imports only files inside the package by relative path`, () => {
      for (const specifier of imports(file)) {
        assert.match(specifier, /^\.{1,2}\/[\w./-]+\.js$/, `${name} imports ${specifier}`);
        const target = resolve(dirname(file), specifier);
        assert.ok(target.startsWith(`${DIST}/`), `${name} imports ${specifier} outside dist`);
        assert.ok(existsSync(target), `${name} imports ${specifier}, which does not exist`);
      }
    });
  }

  for (const name of SCHEMA_NAMES) {
    test(`oatschema/validate/${name} loads only its own validator and no schema text`, () => {
      const files = graph(`validate/${name}.js`);
      const compiled = [...files].filter((file) => file.startsWith("compiled/"));
      assert.ok(compiled.length > 0);
      for (const file of compiled) {
        assert.ok(file.endsWith(`/${name}.js`), file);
      }
      assert.ok(!files.has("bundled.js"));
      assert.ok(!files.has("index.js"));
      for (const file of files) {
        assert.ok(file === `validate/${name}.js` || compiled.includes(file) || SHARED.includes(file), file);
      }
    });
  }

  test("oatschema/validate loads every validator and no schema text", () => {
    const files = graph("validate.js");
    assert.ok(!files.has("bundled.js"));
    for (const name of SCHEMA_NAMES) {
      assert.ok(
        [...files].some((file) => file.startsWith("compiled/") && file.endsWith(`/${name}.js`)),
        name,
      );
    }
  });

  test("the validators run when the runtime forbids code generation from strings", () => {
    const script = [
      'import { validate, isValid } from "oatschema/validate";',
      'import { getValidator } from "oatschema/validate/document-extraction";',
      'let blocked = false; try { eval("1"); } catch { blocked = true; }',
      'if (!blocked) throw new Error("eval was allowed");',
      'if (!isValid({ labels: [{ label: "cat", timestamp: "2026-10-20T12:00:00Z" }] }, "classification")) throw new Error("valid");',
      'if (isValid({ labels: [{ label: "cat", timestamp: "2026-10-20 12:00:00Z" }] }, "classification")) throw new Error("invalid");',
      'try { validate({ labels: "x" }, "classification"); throw new Error("no error"); } catch (e) { if (e.name !== "ValidationError") throw e; }',
      'if (!getValidator().isValid({ unit: "pt", blocks: [] })) throw new Error("document-extraction");',
      'console.log("ok");',
    ].join("\n");
    const result = spawnSync(
      process.execPath,
      ["--disallow-code-generation-from-strings", "--input-type=module", "--eval", script],
      { cwd: PROJECT, encoding: "utf8" },
    );
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), "ok");
  });
});
