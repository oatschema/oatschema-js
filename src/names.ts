// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

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

/** Every bundled schema version, oldest first. */
export const SCHEMA_VERSIONS: readonly ["0.8.0"] = Object.freeze(["0.8.0"] as const);

/** A bundled OATS schema version, such as `"0.8.0"`. */
export type SchemaVersion = (typeof SCHEMA_VERSIONS)[number];

/**
 * The newest bundled OATS schema version, used when no version is given.
 *
 * A schema's own version is in its `x-version` keyword.
 */
export const SCHEMA_VERSION: SchemaVersion = "0.8.0";

/**
 * Return whether `value` is a bundled schema version, narrowing it to {@link SchemaVersion}.
 *
 * Use it on a version read from a record before passing it to `getSchema` or a validator.
 */
export function isSchemaVersion(value: unknown): value is SchemaVersion {
  return typeof value === "string" && (SCHEMA_VERSIONS as readonly string[]).includes(value);
}
