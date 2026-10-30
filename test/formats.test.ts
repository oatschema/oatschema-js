// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addOatsFormats } from "oatschema/ajv";

const formats = new Map<string, (value: string) => boolean>();
addOatsFormats({ addFormat: (name: string, format: (value: string) => boolean) => formats.set(name, format) });
const SIZE = 2 * 1024 * 1024;

function check(name: string, value: string): boolean {
  const format = formats.get(name);
  assert.ok(format !== undefined, name);
  return format(value);
}

describe("format checks take linear time on hostile input", () => {
  const cases: [string, string, boolean][] = [
    ["uri", `x:${"a".repeat(SIZE)}`, true],
    ["uri", `x:${"a".repeat(SIZE)} `, false],
    ["uri", `http://${"a".repeat(SIZE)}@`, true],
    ["uri", `http://${"a:".repeat(SIZE / 2)}`, false],
    ["uri", `http://${"a".repeat(SIZE)}@b@`, false],
    ["uri", `x:${"/a".repeat(SIZE / 2)}#[`, false],
    ["uri", `x:${"%41".repeat(SIZE / 3)}%4`, false],
    ["uri", `x://[${"1:".repeat(SIZE / 2)}]`, false],
    ["uri", `${"a".repeat(SIZE)}`, false],
    ["uri", `x:?${"?/".repeat(SIZE / 2)} `, false],
    ["date-time", `2026-10-20T12:00:00.${"1".repeat(SIZE)}Z`, true],
    ["date-time", `2026-10-20T12:00:00.${"1".repeat(SIZE)}`, false],
    ["date-time", "2".repeat(SIZE), false],
  ];
  for (const [name, value, expected] of cases) {
    test(`${name}: ${value.length} characters starting ${JSON.stringify(value.slice(0, 12))}`, () => {
      const start = performance.now();
      assert.equal(check(name, value), expected);
      assert.ok(performance.now() - start < 2000);
    });
  }
});
