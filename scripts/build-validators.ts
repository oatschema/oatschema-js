// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _, type KeywordErrorDefinition } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import ucs2length from "ajv/dist/runtime/ucs2length.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import { transformSync } from "esbuild";
import { isDateTime, isUri } from "../src/formats.ts";
import { bundledVersions, readVersion } from "./generate.ts";
import { DEFAULT_DEST } from "./sync-schemas.ts";

export const DEFAULT_DIST: string = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const OATS_HEADER = ["// SPDX-FileCopyrightText: 2026 The OATS Authors", "// SPDX-License-Identifier: Apache-2.0"];
const COMPILED_HEADER = [
  "// SPDX-FileCopyrightText: 2026 The OATS Authors",
  "// SPDX-FileCopyrightText: 2015-2021 Evgeny Poberezkin",
  "// SPDX-License-Identifier: Apache-2.0 AND MIT",
];
const FOLDED_KEYWORDS = ["anyOf", "oneOf", "contains"];
const FORBIDDEN: readonly [RegExp, string][] = [
  [/\brequire\s*\(/, "require"],
  [/\beval\b/, "eval"],
  [/\bFunction\s*\(/, "Function"],
  [/\bimport\s*\(/, "dynamic import"],
  [/\bimport\s*\.\s*meta\b/, "import.meta"],
];

/** A generated validator that would not run as plain browser ESM. */
export class BuildError extends Error {
  override name = "BuildError";
}

type RuleTable = { [keyword: string]: boolean | { definition: { error?: KeywordErrorDefinition } } };

function trackBranchErrors(ajv: InstanceType<typeof Ajv2020.default>): void {
  const all = ajv.RULES.all as RuleTable;
  for (const keyword of FOLDED_KEYWORDS) {
    const rule = all[keyword];
    if (typeof rule !== "object" || rule.definition.error === undefined) {
      throw new BuildError(`Ajv has no error definition for ${keyword}`);
    }
    const error = rule.definition.error;
    rule.definition = {
      ...rule.definition,
      error: {
        message: error.message,
        params: (cxt) => {
          if (cxt.errsCount === undefined) {
            throw new BuildError(`Ajv does not track errors for ${keyword}`);
          }
          const original = typeof error.params === "function" ? error.params(cxt) : (error.params ?? _`{}`);
          return _`Object.assign(${original}, {branchErrors: errors - ${cxt.errsCount}})`;
        },
      },
    };
  }
}

/** Return the standalone ESM source of the validator for one schema, before minification. */
export function compileSchema(schemaText: string): string {
  const ajv = new Ajv2020.default({
    allErrors: true,
    messages: false,
    ownProperties: true,
    strictTypes: false,
    strictTuples: false,
    strictRequired: false,
    formats: { "date-time": isDateTime, uri: isUri },
    code: { source: true, esm: true, lines: false, formats: _`oatsFormats` },
  });
  ajv.addKeyword({ keyword: "x-license", schemaType: "object" });
  ajv.addKeyword({ keyword: "x-version", schemaType: "string" });
  trackBranchErrors(ajv);
  const previous = ucs2length.default.code;
  ucs2length.default.code = "oatsUcs2length";
  try {
    const validate = ajv.compile(JSON.parse(schemaText));
    return standaloneCode.default(ajv, validate);
  } finally {
    ucs2length.default.code = previous;
  }
}

/** Return the minified browser module for one schema, importing its helpers from `formatsPath`. */
export function renderCompiled(schemaText: string, formatsPath: string, label: string): string {
  const source = `import { FORMATS as oatsFormats, ucs2length as oatsUcs2length } from ${JSON.stringify(formatsPath)};\n${compileSchema(schemaText)}`;
  const { code } = transformSync(source, {
    format: "esm",
    minify: true,
    treeShaking: true,
    legalComments: "none",
    target: "es2022",
  });
  for (const [pattern, what] of FORBIDDEN) {
    if (pattern.test(code)) {
      throw new BuildError(`${label}: the generated validator uses ${what}`);
    }
  }
  return `${[...COMPILED_HEADER, code.trimEnd()].join("\n")}\n`;
}

function entrySource(name: string, versions: readonly string[]): string {
  const lines = [
    ...OATS_HEADER,
    "",
    ...versions.map((version, index) => `import v${index} from "../compiled/${version}/${name}.js";`),
    'import { versionValidator } from "../validation.js";',
    "",
    'export { SchemaLookupError } from "../errors.js";',
    'export { ValidationError } from "../validation.js";',
    "",
    `const VERSIONS = new Map([${versions.map((version, index) => `[${JSON.stringify(version)}, v${index}]`).join(", ")}]);`,
    "",
    "export function getValidator(version, options) {",
    `  return versionValidator(${JSON.stringify(name)}, VERSIONS, version, options);`,
    "}",
    "",
  ];
  return lines.join("\n");
}

function entryDeclarations(name: string): string {
  const lines = [
    ...OATS_HEADER,
    "",
    "/**",
    ` * Validation of records against the \`${name}\` OATS schema only, with precompiled validators.`,
    " *",
    " * @module",
    " */",
    "",
    'import type { SchemaVersion } from "../names.js";',
    'import type { ValidateOptions, Validator } from "../validation.js";',
    "",
    'export { SchemaLookupError } from "../errors.js";',
    'export { ValidationError, type ValidationErrorDetails, type ValidateOptions, type Validator } from "../validation.js";',
    "",
    "/**",
    ` * Return a cached {@link Validator} for the \`${name}\` schema in schema version \`version\`, or in`,
    " * `SCHEMA_VERSION` if `version` is omitted.",
    " *",
    " * Formats (`date-time`, `uri`, …) are checked unless `options.checkFormats` is `false`.",
    " *",
    ' * @param version An exact bundled version such as `"0.8.0"`.',
    " * @param options Validation options.",
    ` * @throws {SchemaLookupError} \`version\` is not bundled, or does not contain \`${name}\`.`,
    " * @throws {TypeError} `options` is not an object, has an unknown key, or `checkFormats` is not a boolean.",
    " */",
    "export declare function getValidator(version?: SchemaVersion, options?: ValidateOptions): Validator;",
    "",
  ];
  return lines.join("\n");
}

function tableSource(entries: readonly [string, string][]): string {
  const byName = new Map<string, string[]>();
  for (const [version, name] of entries) {
    byName.set(name, [...(byName.get(name) ?? []), version]);
  }
  const lines = [...OATS_HEADER, ""];
  entries.forEach(([version, name], index) => {
    lines.push(`import v${index} from "./${version}/${name}.js";`);
  });
  lines.push("", "export const COMPILED = new Map([");
  for (const [name, versions] of byName) {
    const pairs = versions.map(
      (version) => `[${JSON.stringify(version)}, v${entries.findIndex(([v, n]) => v === version && n === name)}]`,
    );
    lines.push(`  [${JSON.stringify(name)}, new Map([${pairs.join(", ")}])],`);
  }
  lines.push("]);", "");
  return lines.join("\n");
}

/** Write every compiled validator and the `oatschema/validate/<name>` entry points into `dist`. */
export function build(schemasDir: string = DEFAULT_DEST, dist: string = DEFAULT_DIST): string[] {
  const entries: [string, string][] = [];
  const written: string[] = [];
  for (const version of bundledVersions(schemasDir)) {
    const directory = join(dist, "compiled", version);
    mkdirSync(directory, { recursive: true });
    for (const [name, text] of readVersion(schemasDir, version)) {
      const file = join(directory, `${name}.js`);
      writeFileSync(file, renderCompiled(text, "../../formats.js", `${version}/${name}`));
      written.push(file);
      entries.push([version, name]);
    }
  }
  const table = join(dist, "compiled", "index.js");
  writeFileSync(table, tableSource(entries));
  written.push(table);
  const entryDir = join(dist, "validate");
  mkdirSync(entryDir, { recursive: true });
  const names = [...new Set(entries.map(([, name]) => name))].sort();
  for (const name of names) {
    const versions = entries.filter(([, entry]) => entry === name).map(([version]) => version);
    writeFileSync(join(entryDir, `${name}.js`), entrySource(name, versions));
    writeFileSync(join(entryDir, `${name}.d.ts`), entryDeclarations(name));
    written.push(join(entryDir, `${name}.js`), join(entryDir, `${name}.d.ts`));
  }
  return written;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`wrote ${build().length} files`);
  } catch (error) {
    if (error instanceof BuildError) {
      console.error(`error: ${error.message}`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
