// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, missingFromVersion, shorten, UnknownSchemaError, unbundledVersion } from "./errors.ts";
import { withFormats } from "./formats.ts";
import { isSchemaVersion, SCHEMA_VERSION, type SchemaName, type SchemaVersion } from "./names.ts";

const PATH_PART_LIMIT = 100;
const MESSAGE_LIMIT = 1000;
const VALUE = "…";
const ARRAY_KEYWORDS: ReadonlySet<string> = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const DROPPED_KEYWORDS: ReadonlySet<string> = new Set(["if", "propertyNames"]);

/** Options for validation. */
export interface ValidateOptions {
  /** Whether to check formats (`date-time`, `uri`, …). Defaults to `true`. */
  readonly checkFormats?: boolean;
}

/** The details of a {@link ValidationError}. */
export interface ValidationErrorDetails {
  /** The schema's name. */
  readonly schemaName: SchemaName;
  /** The exact schema version. */
  readonly schemaVersion: SchemaVersion;
  /** The location of the failing value within the record. */
  readonly path?: readonly (string | number)[];
  /** The location within the schema of the keyword that rejected it. */
  readonly schemaPath?: readonly (string | number)[];
  /** The JSON Schema keyword that rejected it, such as `"maxLength"` or `"required"`. */
  readonly keyword?: string;
}

/**
 * A record that does not conform to its schema.
 *
 * `path` locates the failing value within the record, `schemaPath` the schema location that rejected it,
 * and `keyword` the JSON Schema keyword at the end of `schemaPath` (`"maxLength"`, `"required"`, …).
 *
 * `reason` shows each value from the record as `…`, quoting only property names, and is at most 1,000 characters.
 * `message` adds the schema and the location, as in `classification 0.8.0 at /labels/0/score: … is greater than the
 * maximum of 1`. Each string in `path` is at most 100 characters, and the location in `message` at most 1,000.
 * The underlying validator's error is not kept.
 */
export class ValidationError extends Error {
  /** Why the value was rejected, without the schema or the location. */
  readonly reason: string;
  /** The schema's name. */
  readonly schemaName: SchemaName;
  /** The exact schema version. */
  readonly schemaVersion: SchemaVersion;
  /** The location of the failing value within the record. Array indices are numbers. */
  readonly path: readonly (string | number)[];
  /** The location within the schema of the keyword that rejected the value. */
  readonly schemaPath: readonly (string | number)[];
  /** The JSON Schema keyword that rejected the value. */
  readonly keyword: string;

  constructor(reason: string, details: ValidationErrorDetails) {
    const bounded = shorten(String(reason), MESSAGE_LIMIT);
    const path = Object.freeze(boundPath(details.path ?? []));
    const schemaPath = Object.freeze(boundPath(details.schemaPath ?? []));
    const name = shorten(String(details.schemaName), PATH_PART_LIMIT);
    const version = shorten(String(details.schemaVersion), PATH_PART_LIMIT);
    const location = shorten(path.join("/"), MESSAGE_LIMIT);
    super(`${name} ${version} at /${location}: ${bounded}`);
    this.reason = bounded;
    this.schemaName = name as SchemaName;
    this.schemaVersion = version as SchemaVersion;
    this.path = path;
    this.schemaPath = schemaPath;
    this.keyword = shorten(String(details.keyword ?? lastKeyword(schemaPath)), PATH_PART_LIMIT);
  }
}

Object.defineProperty(ValidationError.prototype, "name", {
  value: "ValidationError",
  writable: true,
  configurable: true,
  enumerable: false,
});

/**
 * A validator for one schema version, from `getValidator`.
 *
 * Formats (`date-time`, `uri`, …) are checked unless {@link Validator.checkFormats} is `false`.
 * Records are JSON values, such as the result of `JSON.parse`.
 */
export interface Validator {
  /** The schema's name. */
  readonly schemaName: SchemaName;
  /** The exact schema version. */
  readonly schemaVersion: SchemaVersion;
  /** Whether formats (`date-time`, `uri`, …) are checked. */
  readonly checkFormats: boolean;
  /** Return whether `record` conforms. */
  isValid(record: unknown): boolean;
  /**
   * Throw a {@link ValidationError} for the first error in `record`, if there is one.
   *
   * The first error is the first that {@link Validator.iterErrors} yields.
   */
  validate(record: unknown): void;
  /**
   * Return an iterator over every error in `record`, as {@link ValidationError}s.
   *
   * Every error is found before the first is yielded. The same record gives the same errors in the same order,
   * but the order may change between releases.
   */
  iterErrors(record: unknown): IterableIterator<ValidationError>;
}

/** @internal */
export type CompiledValidator = ((data: unknown) => boolean) & { errors?: unknown };

/** @internal */
export type CompiledVersions = ReadonlyMap<string, CompiledValidator>;

/** @internal */
export type CompiledTable = ReadonlyMap<string, CompiledVersions>;

interface RawError {
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
  readonly params: { readonly [key: string]: unknown };
  readonly propertyName?: unknown;
}

interface Folded {
  readonly raw: RawError;
  readonly names?: unknown[];
}

function boundPath(path: readonly unknown[]): (string | number)[] {
  return [...path].map((part) => (typeof part === "number" ? part : shorten(String(part), PATH_PART_LIMIT)));
}

function lastKeyword(schemaPath: readonly (string | number)[]): string {
  for (let index = schemaPath.length - 1; index >= 0; index--) {
    const part = schemaPath[index];
    if (typeof part === "string") {
      return part;
    }
  }
  return "";
}

function unescapePointer(part: string): string {
  return part.replace(/~1/g, "/").replace(/~0/g, "~");
}

function recordPath(pointer: string, record: unknown): (string | number)[] {
  if (pointer === "") {
    return [];
  }
  const path: (string | number)[] = [];
  let node: unknown = record;
  for (const encoded of pointer.slice(1).split("/")) {
    const part = unescapePointer(encoded);
    if (Array.isArray(node) && /^(?:0|[1-9][0-9]*)$/.test(part)) {
      const index = Number(part);
      path.push(index);
      node = node[index];
    } else {
      path.push(shorten(part, PATH_PART_LIMIT));
      node =
        node !== null && typeof node === "object" && Object.hasOwn(node, part)
          ? (node as { [key: string]: unknown })[part]
          : undefined;
    }
  }
  return path;
}

function schemaLocation(pointer: string): (string | number)[] {
  const parts = pointer.replace(/^#/, "").split("/").slice(1).map(unescapePointer);
  return parts.map((part, index) =>
    index > 0 && ARRAY_KEYWORDS.has(parts[index - 1] ?? "") && /^(?:0|[1-9][0-9]*)$/.test(part) ? Number(part) : part,
  );
}

function plural(count: unknown, singular: string, many: string): string {
  return `${String(count)} ${count === 1 ? singular : many}`;
}

function json(value: unknown): string {
  const text = JSON.stringify(value);
  return text === undefined ? String(value) : text;
}

function quoteName(name: unknown): string {
  return JSON.stringify(shorten(String(name), PATH_PART_LIMIT));
}

function candidates(values: unknown): string {
  const list = Array.isArray(values) ? values.map(json) : [json(values)];
  if (list.length <= 1) {
    return list.join("");
  }
  if (list.length <= 3) {
    return `${list.slice(0, -1).join(", ")} or ${list.at(-1)}`;
  }
  return `${list.slice(0, 2).join(", ")} or ${list.length - 2} other candidates`;
}

function reason({ raw, names }: Folded): string {
  const { keyword, params } = raw;
  const value = raw.propertyName === undefined ? VALUE : quoteName(raw.propertyName);
  switch (keyword) {
    case "type": {
      const types = String(params.type).split(",");
      return types.length === 1
        ? `${value} is not of type "${types[0]}"`
        : `${value} is not of types ${types
            .sort()
            .map((type) => `"${type}"`)
            .join(", ")}`;
    }
    case "required":
    case "dependentRequired":
      return `${quoteName(params.missingProperty)} is a required property`;
    case "additionalProperties":
    case "unevaluatedProperties": {
      const list = (names ?? []).map((name) => `'${shorten(String(name), PATH_PART_LIMIT)}'`);
      const kind = keyword === "additionalProperties" ? "Additional" : "Unevaluated";
      return `${kind} properties are not allowed (${list.join(", ")} ${list.length === 1 ? "was" : "were"} unexpected)`;
    }
    case "maxLength":
      return `${value} is longer than ${plural(params.limit, "character", "characters")}`;
    case "minLength":
      return `${value} is shorter than ${plural(params.limit, "character", "characters")}`;
    case "maxItems":
    case "items":
    case "unevaluatedItems":
      return `${value} has more than ${plural(params.limit, "item", "items")}`;
    case "minItems":
      return `${value} has less than ${plural(params.limit, "item", "items")}`;
    case "maxProperties":
      return `${value} has more than ${plural(params.limit, "property", "properties")}`;
    case "minProperties":
      return `${value} has less than ${plural(params.limit, "property", "properties")}`;
    case "minimum":
      return `${value} is less than the minimum of ${String(params.limit)}`;
    case "maximum":
      return `${value} is greater than the maximum of ${String(params.limit)}`;
    case "exclusiveMinimum":
      return `${value} is less than or equal to the minimum of ${String(params.limit)}`;
    case "exclusiveMaximum":
      return `${value} is greater than or equal to the maximum of ${String(params.limit)}`;
    case "multipleOf":
      return `${value} is not a multiple of ${String(params.multipleOf)}`;
    case "enum":
      return `${value} is not one of ${candidates(params.allowedValues)}`;
    case "const":
      return `${json(params.allowedValue)} was expected`;
    case "pattern":
      return `${value} does not match ${json(params.pattern)}`;
    case "format":
      return `${value} is not a ${json(params.format)}`;
    case "uniqueItems":
      return `${value} has non-unique elements`;
    case "anyOf":
      return `${value} is not valid under any of the schemas listed in the 'anyOf' keyword`;
    case "oneOf":
      return Array.isArray(params.passingSchemas)
        ? `${value} is valid under more than one of the schemas listed in the 'oneOf' keyword`
        : `${value} is not valid under any of the schemas listed in the 'oneOf' keyword`;
    case "contains":
      return `None of ${value} are valid under the given schema`;
    case "not":
      return `${value} is not allowed by the 'not' keyword`;
    case "false schema":
      return `False schema does not allow ${value}`;
    default:
      return `${value} is not valid under the ${json(keyword)} keyword`;
  }
}

function asRawErrors(errors: unknown): RawError[] {
  return Array.isArray(errors) ? (errors as RawError[]) : [];
}

function fold(errors: readonly RawError[]): Folded[] {
  const kept: { index: number; raw: RawError }[] = [];
  errors.forEach((raw, index) => {
    const branches = raw.params.branchErrors;
    if (typeof branches === "number" && branches > 0) {
      while ((kept.at(-1)?.index ?? -1) >= index - branches) {
        kept.pop();
      }
    }
    if (!DROPPED_KEYWORDS.has(raw.keyword)) {
      kept.push({ index, raw });
    }
  });
  const folded: Folded[] = [];
  for (const { raw } of kept) {
    if (raw.keyword === "additionalProperties" || raw.keyword === "unevaluatedProperties") {
      const name = raw.params.additionalProperty ?? raw.params.unevaluatedProperty;
      const previous = folded.at(-1);
      if (
        previous?.names !== undefined &&
        previous.raw.keyword === raw.keyword &&
        previous.raw.instancePath === raw.instancePath &&
        previous.raw.schemaPath === raw.schemaPath
      ) {
        if (previous.names.length < MESSAGE_LIMIT) {
          previous.names.push(name);
        }
        continue;
      }
      folded.push({ raw, names: [name] });
      continue;
    }
    folded.push({ raw });
  }
  if (folded.length === 0) {
    const last = errors.at(-1);
    if (last !== undefined) {
      folded.push({ raw: last });
    }
  }
  return folded;
}

class CompiledSchemaValidator implements Validator {
  readonly schemaName: SchemaName;
  readonly schemaVersion: SchemaVersion;
  readonly checkFormats: boolean;
  readonly #compiled: CompiledValidator;

  constructor(name: SchemaName, version: SchemaVersion, checkFormats: boolean, compiled: CompiledValidator) {
    this.schemaName = name;
    this.schemaVersion = version;
    this.checkFormats = checkFormats;
    this.#compiled = compiled;
    Object.freeze(this);
  }

  isValid(record: unknown): boolean {
    return withFormats(this.checkFormats, () => this.#compiled(record));
  }

  validate(record: unknown): void {
    const errors = this.#run(record);
    const first = errors[0];
    if (first !== undefined) {
      throw this.#convert(first, record);
    }
  }

  *iterErrors(record: unknown): IterableIterator<ValidationError> {
    for (const error of this.#run(record)) {
      yield this.#convert(error, record);
    }
  }

  #run(record: unknown): Folded[] {
    const compiled = this.#compiled;
    return withFormats(this.checkFormats, () => (compiled(record) ? [] : fold(asRawErrors(compiled.errors))));
  }

  #convert(error: Folded, record: unknown): ValidationError {
    const schemaPath = schemaLocation(error.raw.schemaPath);
    return new ValidationError(reason(error), {
      schemaName: this.schemaName,
      schemaVersion: this.schemaVersion,
      path: recordPath(error.raw.instancePath, record),
      schemaPath,
      keyword: lastKeyword(schemaPath),
    });
  }

  get [Symbol.toStringTag](): string {
    return `Validator ${this.schemaName} ${this.schemaVersion}${this.checkFormats ? "" : " checkFormats=false"}`;
  }
}

const CACHE = new Map<string, Validator>();

function checkFormatsOption(options: unknown): boolean {
  if (options === undefined) {
    return true;
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`options must be an object, not ${describe(options)}`);
  }
  for (const key of Object.keys(options)) {
    if (key !== "checkFormats") {
      throw new TypeError(`unknown option ${describe(key)}; the only option is "checkFormats"`);
    }
  }
  const check = (options as ValidateOptions).checkFormats;
  if (check === undefined) {
    return true;
  }
  if (typeof check !== "boolean") {
    throw new TypeError(`checkFormats must be true or false, not ${describe(check)}`);
  }
  return check;
}

/** @internal */
export function versionValidator(
  name: SchemaName,
  versions: CompiledVersions,
  version: unknown,
  options: unknown,
): Validator {
  const check = checkFormatsOption(options);
  const resolved = version === undefined ? SCHEMA_VERSION : version;
  if (!isSchemaVersion(resolved)) {
    throw unbundledVersion(name, resolved);
  }
  const compiled = versions.get(resolved);
  if (compiled === undefined) {
    throw missingFromVersion(name, resolved);
  }
  const key = `${name} ${resolved} ${check}`;
  let validator = CACHE.get(key);
  if (validator === undefined) {
    validator = new CompiledSchemaValidator(name, resolved, check, compiled);
    CACHE.set(key, validator);
  }
  return validator;
}

/** @internal */
export function tableValidator(table: CompiledTable, name: unknown, version: unknown, options: unknown): Validator {
  const versions = typeof name === "string" ? table.get(name) : undefined;
  if (versions === undefined) {
    checkFormatsOption(options);
    throw new UnknownSchemaError(name);
  }
  return versionValidator(name as SchemaName, versions, version, options);
}
