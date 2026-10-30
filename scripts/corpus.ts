// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { bundledVersions, readVersion } from "./generate.ts";
import { git, parseTag, resolveTag, DEFAULT_DEST as SCHEMAS_DIR, SyncError, sha256 } from "./sync-schemas.ts";

export const DEFAULT_CORPUS: string = resolve(dirname(fileURLToPath(import.meta.url)), "..", "conformance");
export const CASES_NAME = "cases.json";
const EXAMPLES = "reference/examples";
const EXPECTATIONS = "negative-expectations.json";
const KINDS = ["positive", "negative"] as const;
const FILE_PATTERN = /^[a-z0-9][a-z0-9.-]*\.json$/;
const FORMAT_MESSAGE = /\bis not a "/;
const USAGE = "usage: node scripts/corpus.ts <oats-repo> <tag> [--dest <conformance-dir>]";

/** One record of the conformance corpus, with its expected verdicts. */
export interface Case {
  file: string;
  sha256: string;
  schema: string;
  version: string;
  valid: boolean;
  valid_without_formats: boolean;
  error?: { path: string; message: string };
}

/** The `cases.json` index of a corpus version. */
export interface Cases {
  tag: string;
  commit: string;
  source: string;
  cases: Case[];
}

function schemaFor(file: string, names: readonly string[]): string {
  const matches = names.filter((name) => file.startsWith(name));
  if (matches.length === 0) {
    throw new SyncError(`${file} names no schema in this version`);
  }
  return matches.reduce((longest, name) => (name.length > longest.length ? name : longest));
}

function listJson(repo: string, tag: string, directory: string): string[] {
  return git(repo, "ls-tree", "--name-only", `${tag}:${directory}`)
    .toString()
    .split("\n")
    .filter((entry) => entry.endsWith(".json"))
    .sort();
}

function parseJson(file: string, data: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch (error) {
    throw new SyncError(`${file} is not UTF-8 JSON: ${(error as Error).message}`);
  }
}

/** Return the corpus of the release `tag` of `repo`: the `cases.json` index and each example file's bytes. */
export function buildCorpus(
  repo: string,
  tag: string,
  schemasDir: string = SCHEMAS_DIR,
  commitOf: (repo: string, tag: string) => string = resolveTag,
): { cases: Cases; files: Map<string, Uint8Array> } {
  const version = parseTag(tag).join(".");
  if (!bundledVersions(schemasDir).includes(version)) {
    throw new SyncError(`schema version ${version} is not bundled; run npm run sync first`);
  }
  const names = [...readVersion(schemasDir, version).keys()];
  const commit = commitOf(repo, tag);
  const expectations = parseJson(EXPECTATIONS, git(repo, "show", `${tag}:${EXAMPLES}/${EXPECTATIONS}`)) as Record<
    string,
    { path?: unknown; message?: unknown }
  >;
  const files = new Map<string, Uint8Array>();
  const cases: Case[] = [];
  const negatives = new Set<string>();
  for (const kind of KINDS) {
    for (const entry of listJson(repo, tag, `${EXAMPLES}/${kind}`)) {
      if (!FILE_PATTERN.test(entry)) {
        throw new SyncError(`${kind}/${entry} is not a plain lowercase file name`);
      }
      const file = `${kind}/${entry}`;
      const data = new Uint8Array(git(repo, "show", `${tag}:${EXAMPLES}/${file}`));
      parseJson(file, data);
      files.set(file, data);
      const item: Case = {
        file,
        sha256: sha256(data),
        schema: schemaFor(entry, names),
        version,
        valid: kind === "positive",
        valid_without_formats: kind === "positive",
      };
      if (kind === "negative") {
        negatives.add(entry);
        const expected = expectations[entry];
        if (expected === undefined || typeof expected.path !== "string" || typeof expected.message !== "string") {
          throw new SyncError(`${file} has no path and message in ${EXPECTATIONS}`);
        }
        if (FORMAT_MESSAGE.test(expected.message)) {
          throw new SyncError(`${file} fails on a format, so its verdict without format checks is unknown`);
        }
        item.error = { path: expected.path, message: expected.message };
      }
      cases.push(item);
    }
  }
  for (const entry of Object.keys(expectations)) {
    if (!negatives.has(entry)) {
      throw new SyncError(`${EXPECTATIONS} names ${entry}, which is not a negative example`);
    }
  }
  if (files.size === 0) {
    throw new SyncError(`${tag} has no examples`);
  }
  return { cases: { tag, commit, source: EXAMPLES, cases }, files };
}

/** Write the corpus of the release `tag` of `repo` into `dest` and return its version directory. */
export function writeCorpus(repo: string, tag: string, dest: string = DEFAULT_CORPUS): string {
  const version = parseTag(tag).join(".");
  const target = join(dest, version);
  if (existsSync(target)) {
    throw new SyncError(`${target} already exists; delete it to rebuild the corpus`);
  }
  const { cases, files } = buildCorpus(repo, tag);
  mkdirSync(dest, { recursive: true });
  const staging = mkdtempSync(join(dest, `.${version}-`));
  try {
    chmodSync(staging, 0o755);
    for (const kind of KINDS) {
      mkdirSync(join(staging, kind));
    }
    for (const [file, data] of files) {
      writeFileSync(join(staging, file), data);
    }
    writeFileSync(join(staging, CASES_NAME), `${JSON.stringify(cases, null, 2)}\n`);
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
    console.log(`wrote ${writeCorpus(expandHome(repo), tag, parsed.values.dest ?? DEFAULT_CORPUS)}`);
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
