// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DEST, MANIFEST_NAME, sha256 } from "./sync-schemas.ts";

export const DEFAULT_OUTPUT: string = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "bundled.ts");
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** A bundled version whose files do not match its manifest. */
export class GenerateError extends Error {
  override name = "GenerateError";
}

function versionKey(version: string): number[] {
  return version.split(".").map(Number);
}

function compareVersions(left: string, right: string): number {
  const a = versionKey(left);
  const b = versionKey(right);
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/** Return every bundled version directory in `schemasDir`, oldest first. */
export function bundledVersions(schemasDir: string): string[] {
  return readdirSync(schemasDir)
    .filter((entry) => VERSION_PATTERN.test(entry) && statSync(join(schemasDir, entry)).isDirectory())
    .sort(compareVersions);
}

/** Return each schema's text in a bundled version, keyed by name, after checking it against the manifest. */
export function readVersion(schemasDir: string, version: string): Map<string, string> {
  const directory = join(schemasDir, version);
  const manifest = JSON.parse(readFileSync(join(directory, MANIFEST_NAME), "utf8")) as {
    tag: string;
    files: Record<string, string>;
  };
  if (manifest.tag !== `v${version}`) {
    throw new GenerateError(`${version}: manifest tag is ${JSON.stringify(manifest.tag)}`);
  }
  const files = readdirSync(directory)
    .filter((entry) => entry !== MANIFEST_NAME)
    .sort();
  const expected = Object.keys(manifest.files).sort();
  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    throw new GenerateError(`${version}: files ${files.join(", ")} do not match the manifest's ${expected.join(", ")}`);
  }
  const schemas = new Map<string, string>();
  for (const file of files) {
    const data = readFileSync(join(directory, file));
    if (sha256(data) !== manifest.files[file]) {
      throw new GenerateError(`${version}/${file}: SHA-256 does not match the manifest`);
    }
    schemas.set(
      file.slice(0, -".json".length),
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data),
    );
  }
  return schemas;
}

/** Return the source of the module that embeds every bundled schema. */
export function render(schemasDir: string = DEFAULT_DEST): string {
  const lines = [
    "// SPDX-FileCopyrightText: 2026 The OATS Authors",
    "// SPDX-License-Identifier: Apache-2.0",
    "",
    "export const BUNDLED: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([",
  ];
  for (const version of bundledVersions(schemasDir)) {
    lines.push(`  [${JSON.stringify(version)}, new Map([`);
    for (const [name, text] of readVersion(schemasDir, version)) {
      lines.push(`    [${JSON.stringify(name)}, ${JSON.stringify(text)}],`);
    }
    lines.push("  ])],");
  }
  lines.push("]);", "");
  return lines.join("\n");
}

export function main(argv: string[]): number {
  const check = argv.includes("--check");
  try {
    const source = render();
    if (check) {
      let current = "";
      try {
        current = readFileSync(DEFAULT_OUTPUT, "utf8");
      } catch {
        current = "";
      }
      if (current !== source) {
        console.error("error: src/bundled.ts is out of date; run npm run generate");
        return 1;
      }
      return 0;
    }
    writeFileSync(DEFAULT_OUTPUT, source);
    console.log(`wrote ${DEFAULT_OUTPUT}`);
  } catch (error) {
    if (error instanceof GenerateError) {
      console.error(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
