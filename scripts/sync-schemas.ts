// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const DEFAULT_DEST: string = resolve(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
export const METASCHEMA = "https://json-schema.org/draft/2020-12/schema";
export const MANIFEST_NAME = "MANIFEST.json";
export const FIRST_VERSION: Version = [0, 8, 0];
export const LICENSE_ID = "Apache-2.0";
const NOTICE_PATTERN = /^Copyright \d{4}(?:-\d{4})? The OATS Authors$/;
const RESERVED_NAMES: ReadonlySet<string> = new Set(["changelog", "docs", "latest"]);
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;
const USAGE = "usage: node scripts/sync-schemas.ts <oats-repo> <tag> [--dest <schemas-dir>]";

export type Version = readonly [number, number, number];

/** A release that cannot be bundled. */
export class SyncError extends Error {
  override name = "SyncError";
}

/** Return the numeric version of a release tag such as `v0.8.0`, which must be 0.8.0 or later. */
export function parseTag(tag: string): Version {
  const match = TAG_PATTERN.exec(tag);
  if (match === null) {
    throw new SyncError(`${JSON.stringify(tag)} is not a release tag of the form vX.Y.Z`);
  }
  const version: Version = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!atLeast(version, FIRST_VERSION)) {
    throw new SyncError(`${tag} is older than v${versionText(FIRST_VERSION)}, the first release this package bundles`);
  }
  return version;
}

function versionText(version: Version): string {
  return version.join(".");
}

function atLeast(version: Version, floor: Version): boolean {
  for (let index = 0; index < 3; index++) {
    const difference = (version[index] ?? 0) - (floor[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return true;
}

/** Return the `$id` a schema must have in the given release. */
export function expectedId(name: string, version: Version): string {
  return `https://oatschema.org/${versionText(version)}/${name}`;
}

/** Reject schema names the package and website cannot serve. */
export function checkName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new SyncError(`${JSON.stringify(name)} is not a lowercase kebab-case name starting with a letter`);
  }
  if (RESERVED_NAMES.has(name)) {
    throw new SyncError(`${JSON.stringify(name)} is a reserved name`);
  }
}

/** Return the keys that appear more than once in any single object of a valid JSON document. */
export function duplicateKeys(text: string): string[] {
  const duplicates = new Set<string>();
  const stack: (Set<string> | null)[] = [];
  let expectKey = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      let end = index + 1;
      while (text[end] !== '"') {
        end += text[end] === "\\" ? 2 : 1;
      }
      const keys = stack.at(-1);
      if (expectKey && keys) {
        const key = JSON.parse(text.slice(index, end + 1)) as string;
        if (keys.has(key)) {
          duplicates.add(key);
        }
        keys.add(key);
        expectKey = false;
      }
      index = end + 1;
      continue;
    }
    if (char === "{") {
      stack.push(new Set());
      expectKey = true;
    } else if (char === "[") {
      stack.push(null);
    } else if (char === "}" || char === "]") {
      stack.pop();
    } else if (char === ",") {
      expectKey = stack.at(-1) != null;
    }
    index++;
  }
  return [...duplicates].sort();
}

/** Reject a schema file whose content does not belong in the given release. */
export function checkSchema(name: string, data: Uint8Array, version: Version): void {
  checkName(name);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  } catch (error) {
    throw new SyncError(`${name}: not UTF-8: ${(error as Error).message}`);
  }
  let schema: unknown;
  try {
    schema = JSON.parse(text);
  } catch (error) {
    throw new SyncError(`${name}: invalid JSON: ${(error as Error).message}`);
  }
  const duplicates = duplicateKeys(text);
  if (duplicates.length > 0) {
    throw new SyncError(`${name}: duplicate keys ${JSON.stringify(duplicates)}`);
  }
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new SyncError(`${name}: not a JSON object`);
  }
  const expected: Record<string, string> = {
    $schema: METASCHEMA,
    $id: expectedId(name, version),
    "x-version": versionText(version),
  };
  for (const [key, value] of Object.entries(expected)) {
    const actual = Object.hasOwn(schema, key) ? (schema as Record<string, unknown>)[key] : undefined;
    if (actual !== value) {
      throw new SyncError(`${name}: ${key} is ${JSON.stringify(actual)}, expected ${JSON.stringify(value)}`);
    }
  }
  if (Object.hasOwn(schema, "version")) {
    throw new SyncError(`${name}: has a top-level version keyword; releases from 0.8.0 use x-version`);
  }
  checkLicense(name, Object.hasOwn(schema, "x-license") ? (schema as Record<string, unknown>)["x-license"] : undefined);
}

function checkLicense(name: string, license: unknown): void {
  if (typeof license !== "object" || license === null || Array.isArray(license)) {
    throw new SyncError(`${name}: x-license is ${JSON.stringify(license)}, expected an object`);
  }
  const { id, notice } = license as Record<string, unknown>;
  if (id !== LICENSE_ID) {
    throw new SyncError(`${name}: x-license.id is ${JSON.stringify(id)}, expected ${JSON.stringify(LICENSE_ID)}`);
  }
  if (typeof notice !== "string" || !NOTICE_PATTERN.test(notice)) {
    throw new SyncError(`${name}: x-license.notice is ${JSON.stringify(notice)}, expected a The OATS Authors notice`);
  }
}

function git(repo: string, ...args: string[]): Buffer {
  const result = spawnSync("git", ["-C", repo, ...args], { maxBuffer: 256 * 1024 * 1024 });
  if (result.error) {
    throw new SyncError(`git ${args.join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new SyncError(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout;
}

/** Return the tag's commit, after checking that `origin` has the same tag at the same commit. */
export function resolveTag(repo: string, tag: string): string {
  const local = git(repo, "rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`).toString().trim();
  const remoteLines = git(repo, "ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`);
  const remote = new Map<string, string>();
  for (const line of remoteLines.toString().split("\n")) {
    if (line) {
      const [sha, ref] = line.split("\t");
      if (sha !== undefined && ref !== undefined) {
        remote.set(ref, sha);
      }
    }
  }
  const remoteCommit = remote.get(`refs/tags/${tag}^{}`) ?? remote.get(`refs/tags/${tag}`);
  if (remoteCommit === undefined) {
    throw new SyncError(`${tag} has not been pushed to origin`);
  }
  if (remoteCommit !== local) {
    throw new SyncError(`${tag} is ${local} locally but ${remoteCommit} on origin`);
  }
  return local;
}

/** Return each schema in the tag's `schemas/` directory, keyed by name. */
export function readSchemas(repo: string, tag: string): Map<string, Uint8Array> {
  const listing = git(repo, "ls-tree", "--name-only", `${tag}:schemas`).toString().split("\n");
  const files = listing.filter((entry) => entry.endsWith(".json")).sort();
  if (files.length === 0) {
    throw new SyncError(`${tag} has no schemas`);
  }
  return new Map(
    files.map((entry) => [
      entry.slice(0, -".json".length),
      new Uint8Array(git(repo, "show", `${tag}:schemas/${entry}`)),
    ]),
  );
}

/** Return the SHA-256 of `data` as lowercase hex. */
export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Return the `MANIFEST.json` content for a bundled release. */
export function buildManifest(tag: string, commit: string, schemas: ReadonlyMap<string, Uint8Array>): string {
  const files: Record<string, string> = {};
  for (const name of [...schemas.keys()].sort()) {
    files[`${name}.json`] = sha256(schemas.get(name) as Uint8Array);
  }
  return `${JSON.stringify({ tag, commit, files }, null, 2)}\n`;
}

/** Bundle the release `tag` of `repo` into `dest` and return its version directory. */
export function sync(repo: string, tag: string, dest: string): string {
  const version = parseTag(tag);
  const target = join(dest, versionText(version));
  if (existsSync(target)) {
    throw new SyncError(`${target} already exists; bundled releases are never rewritten`);
  }
  const commit = resolveTag(repo, tag);
  const schemas = readSchemas(repo, tag);
  for (const [name, data] of schemas) {
    checkSchema(name, data, version);
  }
  mkdirSync(dest, { recursive: true });
  const staging = mkdtempSync(join(dest, `.${versionText(version)}-`));
  try {
    chmodSync(staging, 0o755);
    for (const [name, data] of schemas) {
      writeFileSync(join(staging, `${name}.json`), data);
    }
    writeFileSync(join(staging, MANIFEST_NAME), buildManifest(tag, commit, schemas));
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return target;
}

function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

export function main(argv: string[]): number {
  let parsed: ReturnType<typeof parseArgs<{ options: { dest: { type: "string" } }; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: { dest: { type: "string" } }, allowPositionals: true });
  } catch (error) {
    console.error(`${USAGE}\nerror: ${(error as Error).message}`);
    return 2;
  }
  const [repo, tag] = parsed.positionals;
  if (repo === undefined || tag === undefined || parsed.positionals.length !== 2) {
    console.error(USAGE);
    return 2;
  }
  try {
    const target = sync(expandHome(repo), tag, parsed.values.dest ?? DEFAULT_DEST);
    console.log(`bundled ${tag} into ${target}`);
  } catch (error) {
    if (error instanceof SyncError) {
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
