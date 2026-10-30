// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * The OATS (Open Annotation Task Schemas) JSON schemas, bundled for JavaScript and TypeScript.
 *
 * Validation is in `oatschema/validate`, and in `oatschema/validate/<name>` for a single schema.
 *
 * @module
 */

import { BUNDLED } from "./bundled.ts";
import { missingFromVersion, UnknownSchemaError, unbundledVersion } from "./errors.ts";
import { SCHEMA_NAMES, SCHEMA_VERSION, SCHEMA_VERSIONS, type SchemaName, type SchemaVersion } from "./names.ts";

export { SchemaLookupError, UnknownSchemaError } from "./errors.ts";
export { isSchemaVersion, SCHEMA_NAMES, SCHEMA_VERSION, type SchemaName, type SchemaVersion } from "./names.ts";

/** A JSON value, as parsed from a schema file. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A parsed JSON Schema document. */
export type Schema = { [key: string]: JsonValue };

function lookup(name: SchemaName, version: SchemaVersion | undefined): string {
  if (typeof name !== "string" || !(SCHEMA_NAMES as readonly string[]).includes(name)) {
    throw new UnknownSchemaError(name);
  }
  const resolved: unknown = version === undefined ? SCHEMA_VERSION : version;
  const schemas = typeof resolved === "string" ? BUNDLED.get(resolved) : undefined;
  if (schemas === undefined) {
    throw unbundledVersion(name, resolved);
  }
  const text = schemas.get(name);
  if (text === undefined) {
    throw missingFromVersion(name, resolved as string);
  }
  return text;
}

/** Return every bundled schema version, oldest first. */
export function availableVersions(): SchemaVersion[] {
  return [...SCHEMA_VERSIONS];
}

/**
 * Return the schema `name` from schema version `version`, or from {@link SCHEMA_VERSION} if it is omitted.
 *
 * Each call returns a new object, so callers may modify it freely.
 *
 * @param name The schema name, such as `"classification"`.
 * @param version An exact bundled version such as `"0.8.0"`. Partial versions and aliases are not accepted.
 * @throws {UnknownSchemaError} `name` is not a schema in any bundled version.
 * @throws {SchemaLookupError} `version` is not bundled, or does not contain `name`.
 */
export function getSchema(name: SchemaName, version?: SchemaVersion): Schema {
  return JSON.parse(lookup(name, version)) as Schema;
}

/**
 * Return the text of the schema `name` from schema version `version` exactly as released, or from
 * {@link SCHEMA_VERSION} if `version` is omitted.
 *
 * @param name The schema name, such as `"classification"`.
 * @param version An exact bundled version such as `"0.8.0"`. Partial versions and aliases are not accepted.
 * @throws {UnknownSchemaError} `name` is not a schema in any bundled version.
 * @throws {SchemaLookupError} `version` is not bundled, or does not contain `name`.
 */
export function getSchemaJson(name: SchemaName, version?: SchemaVersion): string {
  return lookup(name, version);
}
