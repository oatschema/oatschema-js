# Contributing

## Setup

Use Node.js 22.18 or newer, which runs the TypeScript scripts and tests directly. The published package itself supports Node.js 22 and later.

```
npm ci
npm run check        # lint, typecheck and test
npm run lint         # biome
npm run format       # biome, applying fixes
npm run typecheck    # tsc: src as browser code, then src, scripts and tests with Node types
npm test             # build dist/, then run node --test against it
```

The tests also compare every bundled schema with its oats release tag. They use a checkout of [oatschema/oats](https://github.com/oatschema/oats) at `$OATS_REPO` (default `~/projects/oats`), and skip that suite if there is none.

## Layout

- `src/index.ts`: the public API. `SCHEMA_VERSION` and `SCHEMA_NAMES` are written by hand so type checkers see them; the tests keep them in step with the bundled files.
- `schemas/<version>/`: each bundled OATS release, copied byte for byte from its tag, with a `MANIFEST.json` recording the tag, its commit and each file's SHA-256. These files are never edited. The package bundles OATS 0.8.0 and later only.
- `src/bundled.ts`: generated from `schemas/` by `npm run generate`. It embeds each schema's text, so the package reads no files at runtime. Never edit it by hand; a test fails if it is out of date.
- `scripts/sync-schemas.ts` and `scripts/generate.ts`: the maintainer scripts below.

## Bundling a new OATS release

Schemas come only from release tags of oats, never from a working tree, and a bundled version is never changed.

1. Make sure the release is tagged and pushed in oats, and fetch the tags into your checkout.
2. Bundle it: `npm run sync -- ~/projects/oats vX.Y.Z`. The script:
   - reads `schemas/*.json` from the tag with `git show`, ignoring the working tree;
   - refuses a tag older than `v0.8.0`;
   - refuses a tag that isn't on `origin`, or that points to a different commit there;
   - checks each file:
     - a valid kebab-case name that isn't reserved (`changelog`, `docs`, `latest`);
     - UTF-8 JSON with no duplicate keys;
     - the 2020-12 `$schema`, and the `$id` `https://oatschema.org/<version>/<name>`;
     - `x-version` equal to the tag, and no top-level `version` keyword;
     - an `x-license` with `id` `Apache-2.0` and a notice naming The OATS Authors;
   - refuses to write into an existing version directory;
   - writes into a staging directory and renames it into place, so a failure leaves nothing behind.
3. Regenerate the embedded module: `npm run generate`. It checks every file against its manifest first.
4. Update `SCHEMA_VERSION` and `SCHEMA_NAMES` in `src/index.ts`, the README examples and `CHANGELOG.md`.
5. Bump the package's minor version (before 1.0) in both `package.json` and `jsr.json`, then run `npm run check`.

## Releasing

Releases are published by `.github/workflows/release.yml` when a `v*` tag is pushed. It checks that the tag equals `v` plus the `package.json` version, runs the checks, and publishes to npm with trusted publishing (OIDC) and provenance, so no npm token is stored. Before tagging, run `npm pack --dry-run` and `npx jsr publish --dry-run`.

## Licensing and sign-off

- Contributions are licensed under the [Apache License 2.0](LICENSE), the same licence the project is distributed under. There is no CLA.
- You keep the copyright in your contributions. Copyright in OATS is held by [The OATS Authors](AUTHORS); you may add yourself or your employer to `AUTHORS` in your pull request.
- Every commit needs a [Developer Certificate of Origin](https://developercertificate.org/) sign-off. Add it with `git commit -s`, which appends a `Signed-off-by:` line.
- New source files (TypeScript, JavaScript, YAML) start with the two-line SPDX header, in the file type's comment syntax:
  ```
  // SPDX-FileCopyrightText: 2026 The OATS Authors
  // SPDX-License-Identifier: Apache-2.0
  ```
  The year is the year this repository started; don't update it. `scripts/generate.ts` writes the same header into `src/bundled.ts`. JSON and Markdown files carry no header.
