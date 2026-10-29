// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How much of a trial is left, in the largest unit that is not nought. */
export type TrialRemaining =
  | { unit: "days" | "hours" | "minutes"; count: number }
  | { unit: "moment" };

/**
 * What is left between `now` and `endsAt`: whole days while a day or more is left, then whole
 * hours, then whole minutes, then "a moment". A trial that already ended its banner has not heard
 * of yet is a moment too. A date that cannot be read is one as well: nothing is made up.
 */
export function remainingOf(endsAt: string, now: number): TrialRemaining {
  const end = Date.parse(endsAt);
  const left = Number.isNaN(end) ? 0 : end - now;
  if (left >= DAY) return { unit: "days", count: Math.floor(left / DAY) };
  if (left >= HOUR) return { unit: "hours", count: Math.floor(left / HOUR) };
  if (left >= MINUTE) return { unit: "minutes", count: Math.floor(left / MINUTE) };
  return { unit: "moment" };
}

/** An instant a host or a story fixes, as the clock would give it. */
export type TrialNow = Date | string | number;

const asMilliseconds = (value: TrialNow): number =>
  value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);

/**
 * The instant the countdown counts from. The clock, read again every half minute, unless the host
 * fixes it: a server render, a story and a test pass the same instant every time, and nothing ticks.
 */
export function useTrialNow(fixed: TrialNow | undefined): number {
  const [clock, setClock] = React.useState(() => Date.now());
  const frozen = fixed !== undefined;
  React.useEffect(() => {
    if (frozen) return;
    const timer = setInterval(() => setClock(Date.now()), MINUTE / 2);
    return () => clearInterval(timer);
  }, [frozen]);
  return frozen ? asMilliseconds(fixed) : clock;
}
