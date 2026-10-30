// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import { SCHEMA_NAMES, SCHEMA_VERSIONS } from "./names.ts";

const DESCRIBE_LIMIT = 100;

/** Return `text`, cut to at most `limit` characters with a trailing `…` if it is longer. */
export function shorten(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  let end = limit - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    end -= 1;
  }
  return `${text.slice(0, end)}…`;
}

/** Return a short, bounded description of a requested name or version, for an error message. */
export function describe(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(shorten(value, DESCRIBE_LIMIT));
  }
  if (value === null || ["undefined", "number", "boolean", "bigint"].includes(typeof value)) {
    return shorten(String(value), DESCRIBE_LIMIT);
  }
  return `a value of type ${typeof value}`;
}

function bounded(value: unknown): unknown {
  return typeof value === "string" ? shorten(value, DESCRIBE_LIMIT) : value;
}

/** Thrown when a schema name exists in no bundled version. */
export class UnknownSchemaError extends Error {
  override name = "UnknownSchemaError";
  /** The name that was requested, cut to 100 characters if it is a longer string. */
  readonly schemaName: unknown;

  constructor(schemaName: unknown) {
    super(`unknown schema name ${describe(schemaName)}; expected one of ${[...SCHEMA_NAMES].sort().join(", ")}`);
    this.schemaName = bounded(schemaName);
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
  /** The schema version that was requested, cut to 100 characters if it is a longer string. */
  readonly schemaVersion: unknown;

  constructor(schemaName: string, schemaVersion: unknown, message: string) {
    super(message);
    this.schemaName = bounded(schemaName) as string;
    this.schemaVersion = bounded(schemaVersion);
  }
}

/** Return the error for a version that is not bundled. */
export function unbundledVersion(name: string, version: unknown): SchemaLookupError {
  return new SchemaLookupError(
    name,
    version,
    `schema version ${describe(version)} is not bundled; available: ${SCHEMA_VERSIONS.join(", ")}`,
  );
}

/** Return the error for a bundled version that does not contain the schema. */
export function missingFromVersion(name: string, version: string): SchemaLookupError {
  return new SchemaLookupError(name, version, `schema ${describe(name)} is not in schema version ${version}`);
}
