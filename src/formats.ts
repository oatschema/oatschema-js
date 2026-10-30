// SPDX-FileCopyrightText: 2026 The OATS Authors
// SPDX-License-Identifier: Apache-2.0

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const UNRESERVED = "A-Za-z0-9\\-._~";
const SUB_DELIMS = "!$&'()*+,;=";
const PCT = "%[0-9A-Fa-f]{2}";
const PCHAR = `(?:[${UNRESERVED}${SUB_DELIMS}:@]|${PCT})`;
const SEGMENT = `${PCHAR}*`;
const SEGMENT_NZ = `${PCHAR}+`;
const H16 = "[0-9A-Fa-f]{1,4}";
const DEC_OCTET = "(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";
const IPV4 = `${DEC_OCTET}(?:\\.${DEC_OCTET}){3}`;
const LS32 = `(?:${H16}:${H16}|${IPV4})`;
const IPV6 = [
  `(?:${H16}:){6}${LS32}`,
  `::(?:${H16}:){5}${LS32}`,
  `(?:${H16})?::(?:${H16}:){4}${LS32}`,
  `(?:(?:${H16}:){0,1}${H16})?::(?:${H16}:){3}${LS32}`,
  `(?:(?:${H16}:){0,2}${H16})?::(?:${H16}:){2}${LS32}`,
  `(?:(?:${H16}:){0,3}${H16})?::${H16}:${LS32}`,
  `(?:(?:${H16}:){0,4}${H16})?::${LS32}`,
  `(?:(?:${H16}:){0,5}${H16})?::${H16}`,
  `(?:(?:${H16}:){0,6}${H16})?::`,
].join("|");
const IP_FUTURE = `[vV][0-9A-Fa-f]+\\.[${UNRESERVED}${SUB_DELIMS}:]+`;
const HOST = `(?:\\[(?:${IPV6}|${IP_FUTURE})\\]|(?:[${UNRESERVED}${SUB_DELIMS}]|${PCT})*)`;
const AUTHORITY = `(?:(?:[${UNRESERVED}${SUB_DELIMS}:]|${PCT})*@)?${HOST}(?::[0-9]*)?`;
const HIER_PART = `(?:\\/\\/${AUTHORITY}(?:\\/${SEGMENT})*|\\/(?:${SEGMENT_NZ}(?:\\/${SEGMENT})*)?|${SEGMENT_NZ}(?:\\/${SEGMENT})*)?`;
const QUERY = `(?:${PCHAR}|[/?])*`;
const URI = new RegExp(`^[A-Za-z][A-Za-z0-9+\\-.]*:${HIER_PART}(?:\\?${QUERY})?(?:#${QUERY})?$`);

let checking = true;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Return whether `value` is an RFC 3339 `date-time`, as JSON Schema's `date-time` format requires.
 *
 * The date and time are separated by `T` (or `t`), the offset is `Z` (or `z`) or `±hh:mm`, and the date must exist.
 * A leap second (`:60`) is accepted only at 23:59 UTC, after applying the offset.
 */
export function isDateTime(value: string): boolean {
  const match = DATE_TIME.exec(value);
  if (match === null) {
    return false;
  }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const days = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  if (day > days || hour > 23 || minute > 59 || second > 60) {
    return false;
  }
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  if (offsetHour > 23 || offsetMinute > 59) {
    return false;
  }
  if (second === 60) {
    const sign = match[7] === "-" ? -1 : 1;
    const utc = (((hour * 60 + minute - sign * (offsetHour * 60 + offsetMinute)) % 1440) + 1440) % 1440;
    return utc === 23 * 60 + 59;
  }
  return true;
}

/**
 * Return whether `value` is an absolute RFC 3986 URI, as JSON Schema's `uri` format requires.
 *
 * Only ASCII is accepted, so an IRI or a URI with an unencoded space is not a `uri`. An empty path, as in `x:`, is.
 */
export function isUri(value: string): boolean {
  return URI.test(value);
}

/** @internal */
export function ucs2length(value: string): number {
  const length = value.length;
  let count = 0;
  for (let index = 0; index < length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index++;
      }
    }
    count++;
  }
  return count;
}

/** @internal */
export const FORMATS: { readonly "date-time": (value: string) => boolean; readonly uri: (value: string) => boolean } =
  Object.freeze({
    "date-time": (value: string): boolean => !checking || isDateTime(value),
    uri: (value: string): boolean => !checking || isUri(value),
  });

/** @internal */
export function withFormats<T>(check: boolean, action: () => T): T {
  const previous = checking;
  checking = check;
  try {
    return action();
  } finally {
    checking = previous;
  }
}
