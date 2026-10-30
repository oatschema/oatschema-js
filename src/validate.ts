// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Validation of records against the bundled OATS schemas, with precompiled validators.
 *
 * The validators generate no code at run time and have no dependencies, so they run under a strict Content Security
 * Policy and in a browser without a bundler. This module includes every schema; to load only one, import
 * `oatschema/validate/<name>` instead.
 *
 * @module
 */

import { COMPILED } from "./compiled/index.js";
import type { SchemaName, SchemaVersion } from "./names.ts";
import { tableValidator, type ValidateOptions, type ValidationError, type Validator } from "./validation.ts";

export { SchemaLookupError, UnknownSchemaError } from "./errors.ts";
export { type ValidateOptions, ValidationError, type ValidationErrorDetails, type Validator } from "./validation.ts";

/**
 * Return a cached {@link Validator} for the schema `name` in schema version `version`, or in `SCHEMA_VERSION` if
 * `version` is omitted.
 *
 * Formats (`date-time`, `uri`, …) are checked unless `options.checkFormats` is `false`.
 *
 * @param name The schema name, such as `"classification"`.
 * @param version An exact bundled version such as `"0.8.0"`.
 * @param options Validation options.
 * @throws {UnknownSchemaError} `name` is not a schema in any bundled version.
 * @throws {SchemaLookupError} `version` is not bundled, or does not contain `name`.
 * @throws {TypeError} `options` is not an object, has an unknown key, or `checkFormats` is not a boolean.
 */
export function getValidator(name: SchemaName, version?: SchemaVersion, options?: ValidateOptions): Validator {
  return tableValidator(COMPILED, name, version, options);
}

/**
 * Check `record` against the schema `name` in schema version `version`, or in `SCHEMA_VERSION` if `version` is
 * omitted, and throw a {@link ValidationError} for the first error.
 *
 * Before OATS 1.0.0, a schema version may reject records that an older one accepted, so pass the version a record was
 * written for. Arguments and other errors are as for {@link getValidator}; {@link iterErrors} returns every error.
 *
 * @throws {ValidationError} `record` does not conform.
 */
export function validate(record: unknown, name: SchemaName, version?: SchemaVersion, options?: ValidateOptions): void {
  tableValidator(COMPILED, name, version, options).validate(record);
}

/**
 * Return whether `record` conforms to the schema `name` in schema version `version`.
 *
 * Arguments and errors are as for {@link validate}, except that a record that does not conform returns `false`.
 */
export function isValid(
  record: unknown,
  name: SchemaName,
  version?: SchemaVersion,
  options?: ValidateOptions,
): boolean {
  return tableValidator(COMPILED, name, version, options).isValid(record);
}

/**
 * Return an iterator over every error in `record` against the schema `name` in schema version `version`.
 *
 * Arguments and errors are as for {@link validate}, except that each error is yielded rather than thrown.
 */
export function iterErrors(
  record: unknown,
  name: SchemaName,
  version?: SchemaVersion,
  options?: ValidateOptions,
): IterableIterator<ValidationError> {
  return tableValidator(COMPILED, name, version, options).iterErrors(record);
}
