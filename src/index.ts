// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * The OATS (Open Annotation Task Schemas) JSON schemas, bundled for JavaScript and TypeScript.
 *
 * @module
 */

import { BUNDLED } from "./bundled.ts";

/** The names of the schemas in {@link SCHEMA_VERSION}. Older bundled versions contain a subset of them. */
export const SCHEMA_NAMES: readonly [
  "audio-transcription",
  "classification",
  "document-extraction",
  "embedding",
  "entity-extraction",
  "generic",
  "geolocation",
  "llm-output",
  "object-detection",
  "ranking",
  "regression",
  "temporal-segmentation",
] = Object.freeze([
  "audio-transcription",
  "classification",
  "document-extraction",
  "embedding",
  "entity-extraction",
  "generic",
  "geolocation",
  "llm-output",
  "object-detection",
  "ranking",
  "regression",
  "temporal-segmentation",
] as const);

/** The name of an OATS schema, such as `"classification"`. */
export type SchemaName = (typeof SCHEMA_NAMES)[number];

/**
 * The newest bundled OATS schema version, used when no version is given.
 *
 * A schema's own version is in its `x-version` keyword.
 */
export const SCHEMA_VERSION = "0.8.0";

/** A JSON value, as parsed from a schema file. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A parsed JSON Schema document. */
export type Schema = { [key: string]: JsonValue };

/** Thrown when a schema name exists in no bundled version. */
export class UnknownSchemaError extends Error {
  override name = "UnknownSchemaError";
  /** The name that was requested. */
  readonly schemaName: unknown;

  constructor(schemaName: unknown) {
    const known = [...new Set([...BUNDLED.values()].flatMap((names) => [...names.keys()]))].sort();
    super(`unknown schema name ${describe(schemaName)}; expected one of ${known.join(", ")}`);
    this.schemaName = schemaName;
  }
}

/**
 * Thrown when a schema version is not bundled, or does not contain the requested schema.
 * Versions must be exact, such as `"0.8.0"`; `"0.8"` and `"latest"` are not bundled versions.
 */
export class SchemaLookupError extends Error {
  override name = "SchemaLookupError";
  /** The schema name that was requested. */
  readonly schemaName: string;
  /** The schema version that was requested. */
  readonly schemaVersion: unknown;

  constructor(schemaName: string, schemaVersion: unknown, message: string) {
    super(message);
    this.schemaName = schemaName;
    this.schemaVersion = schemaVersion;
  }
}

function describe(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function lookup(name: SchemaName, version: string | undefined): string {
  const names = [...BUNDLED.values()];
  if (typeof name !== "string" || !names.some((schemas) => schemas.has(name))) {
    throw new UnknownSchemaError(name);
  }
  const resolved: unknown = version === undefined ? SCHEMA_VERSION : version;
  const schemas = typeof resolved === "string" ? BUNDLED.get(resolved) : undefined;
  if (schemas === undefined) {
    throw new SchemaLookupError(
      name,
      resolved,
      `schema version ${describe(resolved)} is not bundled; available: ${[...BUNDLED.keys()].join(", ")}`,
    );
  }
  const text = schemas.get(name);
  if (text === undefined) {
    throw new SchemaLookupError(name, resolved, `schema ${describe(name)} is not in schema version ${resolved}`);
  }
  return text;
}

/** Return every bundled schema version, oldest first. */
export function availableVersions(): string[] {
  return [...BUNDLED.keys()];
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
export function getSchema(name: SchemaName, version?: string): Schema {
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
export function getSchemaJson(name: SchemaName, version?: string): string {
  return lookup(name, version);
}
