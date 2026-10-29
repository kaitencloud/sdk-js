// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { KaitenDateFormatOptions, KaitenDateInput } from "./types.ts";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function fallbackDateText(value: KaitenDateInput, fallback: string | undefined): string {
  if (fallback !== undefined) return fallback;
  if (typeof value === "string" && value.trim().length > 0) return value;
  return "Unknown date";
}

function parseDateInput(value: KaitenDateInput): Date | null {
  if (typeof value === "string") {
    // A date-only string ("2026-12-31") has no time/zone — read it in the host's
    // local calendar instead of as UTC midnight, otherwise a renewal date can
    // display one day early west of UTC. Full timestamps keep their instant.
    const dateOnly = DATE_ONLY.exec(value);
    if (dateOnly) {
      const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatKaitenDate(
  value: KaitenDateInput,
  options: KaitenDateFormatOptions = {},
): string {
  const { locale, fallback, dateStyle, timeZone, ...formatOptions } = options;
  const date = parseDateInput(value);
  if (!date) return fallbackDateText(value, fallback);

  try {
    return new Intl.DateTimeFormat(locale, {
      ...formatOptions,
      dateStyle: dateStyle ?? "medium",
      // Default to the host time zone. Forcing UTC shifted "day" dates by
      // one; callers who want a fixed zone still pass `timeZone` explicitly.
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
}

/**
 * Bounds of an entitlement usage window.
 *
 * The only date helper here pinned to UTC, and deliberately so: the API defines
 * these windows on UTC boundaries — a `CALENDAR` anchor is documented as
 * "UTC calendar-aligned" — so rendering them in the viewer's zone would show a
 * March calendar month as "Feb 28 → Mar 31" to anyone west of Greenwich. The
 * zone name is rendered too, so the reader knows which clock they are reading.
 *
 * It does NOT delegate to {@link formatKaitenDate}, which forces
 * `dateStyle: "medium"`. `Intl` throws `TypeError: Invalid option` the moment
 * `dateStyle` meets individual components, and that function's `catch` swallows
 * the throw into a `YYYY-MM-DD` string built from `getFullYear`/`getMonth`/
 * `getDate` — the host's zone, no time, no zone name. The delegation would have
 * failed silently into the worst available answer.
 */
export function formatKaitenUsageWindowBound(
  value: KaitenDateInput,
  options: { locale?: string; fallback?: string } = {},
): string {
  const { locale, fallback } = options;
  const date = parseDateInput(value);
  if (!date) return fallbackDateText(value, fallback);

  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return fallbackDateText(value, fallback);
  }
}
