# Contributing

## Setup

Use Node.js 22.18 or newer, which runs the TypeScript scripts and tests directly. The published package itself supports Node.js 22 and later.

```
npm ci
npm run check        # lint, typecheck and test
npm run lint         # biome
npm run format       # biome, applying fixes
npm run build        # tsc, then compile the validators into dist/
npm run typecheck    # build, then tsc over src, scripts and tests with Node types
npm test             # build dist/, then run node --test against it
```

The tests also compare every bundled schema and the conformance corpus with their oats release tag. They use a checkout of [oatschema/oats](https://github.com/oatschema/oats) at `$OATS_REPO` (default `~/projects/oats`), and skip that suite if there is none.

## Layout

- `src/index.ts`: the schema API (`oatschema`). `src/names.ts` holds `SCHEMA_VERSION`, `SCHEMA_VERSIONS` and `SCHEMA_NAMES`, written by hand so type checkers see them; the tests keep them in step with the bundled files.
- `src/validate.ts` (`oatschema/validate`) and `src/validation.ts`: validation. `src/validation.ts` turns the compiled validators' raw errors into bounded `ValidationError`s, and is shared by every entry point. `src/formats.ts` has the `date-time` and `uri` checks, and `src/ajv.ts` is `oatschema/ajv`.
- `scripts/build-validators.ts`: run by `npm run build` after `tsc`. It compiles each bundled schema with Ajv into a standalone, minified module in `dist/compiled/<version>/<name>.js`, and writes the `oatschema/validate/<name>` entry points and `dist/compiled/index.js`. Ajv and esbuild are build-time dependencies only. The build refuses output that uses `require`, `eval`, `Function` or a dynamic import. Ajv is pinned to an exact version, and `THIRD-PARTY-NOTICES` names it; update both together.
- `conformance/<version>/`: every example from the oats release tag (`reference/examples/`), byte for byte, with `cases.json` giving each file's schema, SHA-256 and expected verdict with format checks on (`valid`) and off (`valid_without_formats`), and, for a negative example, the path and message fragment oats expects. `conformance/formats.json` adds format edge cases, embedded in a record as its `records` entry describes. The corpus is meant to be reused by the other OATS ports.
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
4. Add its conformance corpus: `npm run corpus -- ~/projects/oats vX.Y.Z`. Like the sync, it reads the tag with `git show` and checks it against `origin`. If a negative example fails only on a format, the script stops, because its verdict without format checks can't be derived; add that case by hand.
5. Update `SCHEMA_VERSION`, `SCHEMA_VERSIONS` and `SCHEMA_NAMES` in `src/names.ts`, the README examples and `CHANGELOG.md`. If the new schemas use a format other than `date-time` and `uri`, add it to `src/formats.ts` and to `conformance/formats.json`; the build fails until you do.
6. Bump the package's minor version (before 1.0) in `package.json`, then run `npm run check` and the corpus check against oatschema-py below.

## Checking the corpus against oatschema-py

oatschema-py is the reference implementation. To check every verdict in `conformance/` against it, with format checks on and off, install [uv](https://docs.astral.sh/uv/) and run:

```
uv run --no-project --with 'oatschema[validate]==0.8.0.1' --with 'jsonschema-rs==0.59.0' python scripts/check_corpus.py
```

It prints each disagreement and exits with status 1 if there is one. CI runs the same check. Use the oatschema-py release that bundles the newest schema version here, and the jsonschema-rs version that release is tested with.

## Releasing

Releases are published to npm by `.github/workflows/release.yml` when a `v*` tag is pushed. It checks that the tag equals `v` plus the `package.json` version, runs the checks, and publishes with npm trusted publishing: npm accepts a short-lived OIDC token from that workflow instead of a stored token, and attaches a provenance statement linking the package to the commit and the run. No npm token exists for this package. The job skips a version that is already on npm.

### One-time setup

A maintainer with publish rights on npm does this once, just before the first tag that uses it. npm deletes a trusted-publisher entry that hasn't published within two days, so don't set it up early.

1. In the GitHub repository settings, make sure an environment named `npm` exists, and limit its deployments to tags matching `v*`.
2. On npmjs.com, in the package's settings, add a trusted publisher for GitHub Actions: organisation `oatschema`, repository `oatschema-js`, workflow `release.yml` and environment `npm`.
3. After the first trusted publish succeeds, set the package's publishing access to require two-factor authentication and disallow tokens.

If the publish fails, check that `repository.url` in `package.json` matches the repository, that the workflow file name and environment match the npm entry exactly, and that the job has `id-token: write`.

### Each release

1. Set `version` in `package.json` and add a dated entry to `CHANGELOG.md`.
2. Run `npm ci && npm run check && npm pack --dry-run`, and the corpus check above.
3. Commit with a sign-off, push, and wait for CI.
4. Tag the commit `vX.Y.Z` and push the tag. The release workflow publishes it.

### Manual fallback

If trusted publishing is unavailable, a maintainer can publish from a clean checkout of the tagged commit with `npm ci && npm run check && npm publish --access public` (which builds `dist/` first), logged in to npm with two-factor authentication. Then push the tag as usual; the workflow sees the version on npm and skips its publish. A manual publish has no provenance statement.

## Licensing and sign-off

- Contributions are licensed under the [Apache License 2.0](LICENSE), the same licence the project is distributed under. There is no CLA.
- You keep the copyright in your contributions. Copyright in OATS is held by [The OATS Authors](AUTHORS); you may add yourself or your employer to `AUTHORS` in your pull request.
- Every commit needs a [Developer Certificate of Origin](https://developercertificate.org/) sign-off. Add it with `git commit -s`, which appends a `Signed-off-by:` line.
- New source files (TypeScript, JavaScript, Python, YAML) start with the two-line SPDX header, in the file type's comment syntax:
  ```
  // SPDX-FileCopyrightText: 2026 The OATS Authors
  // SPDX-License-Identifier: Apache-2.0
  ```
  The year is the year this repository started; don't update it. `scripts/generate.ts` writes the same header into `src/bundled.ts`, and the build writes it into every generated module. The compiled validators also name Ajv's copyright holder and carry `SPDX-License-Identifier: Apache-2.0 AND MIT`, because Ajv generates their code. JSON and Markdown files carry no header.
