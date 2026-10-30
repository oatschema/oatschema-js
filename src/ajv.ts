// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Helpers for validating OATS records with your own Ajv instance.
 *
 * `oatschema/validate` needs no Ajv. Use these only if you already compile schemas with Ajv yourself.
 *
 * @module
 */

import { isDateTime, isUri } from "./formats.ts";

/** The part of an Ajv instance that {@link addOatsKeywords} uses. */
export interface KeywordTarget {
  addKeyword(definition: { keyword: string; schemaType: "object" | "string" }): unknown;
}

/** The part of an Ajv instance that {@link addOatsFormats} uses. */
export interface FormatTarget {
  addFormat(name: string, format: (value: string) => boolean): unknown;
}

/**
 * Register the two non-standard OATS keywords, `x-license` (an object) and `x-version` (a string), so that Ajv's
 * strict mode accepts the schemas. Returns `ajv`.
 */
export function addOatsKeywords<T extends KeywordTarget>(ajv: T): T {
  ajv.addKeyword({ keyword: "x-license", schemaType: "object" });
  ajv.addKeyword({ keyword: "x-version", schemaType: "string" });
  return ajv;
}

/**
 * Register the `date-time` and `uri` formats with the same checks as `oatschema/validate`, which are stricter than
 * `ajv-formats` for `date-time` (RFC 3339 only) and accept every RFC 3986 URI. Returns `ajv`.
 */
export function addOatsFormats<T extends FormatTarget>(ajv: T): T {
  ajv.addFormat("date-time", isDateTime);
  ajv.addFormat("uri", isUri);
  return ajv;
}
