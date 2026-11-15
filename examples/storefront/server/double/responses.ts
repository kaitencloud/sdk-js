// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What the stand-in for Kaiten answers with, whichever route it answers: a response in the shape
// of the API's (a JSON body, or a problem with a `code`), the pages of the payment provider, and
// the few helpers its sums and its dates share.

type Json = Record<string, any>;

/** A response: a JSON body for a status below 400, a problem above, and the headers it carries (`Retry-After`, say). */
export const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": status < 400 ? "application/json" : "application/problem+json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });

/** A refusal in the shape Kaiten's are: a problem with a `code`, and what else `more` adds (`errors`). */
export const problem = (
  status: number,
  code: string,
  detail: string,
  instance = "",
  more: Json = {},
  headers: Record<string, string> = {},
) =>
  reply(
    status,
    {
      type: "https://tools.ietf.org/html/rfc7231",
      title: status === 401 ? "Unauthorized" : status === 429 ? "Too Many Requests" : "Refused",
      status,
      detail,
      instance,
      code,
      ...more,
    },
    headers,
  );

/** A page of the payment provider. */
export const html = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
      `<meta name="color-scheme" content="light dark">` +
      `<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem}` +
      `button{font:inherit;padding:.5rem 1rem;margin:.25rem .25rem .25rem 0}` +
      `footer{margin-top:2.5rem;font-size:.8125rem;opacity:.7}</style>` +
      `</head><body>${body}<footer>Stand-in for Kaiten: no payment is real.</footer></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );

/** The months a billing period spans. */
export const MONTHS: Record<string, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  ANNUAL: 12,
};

export const iso = (time: number) => new Date(time).toISOString();

export function addMonths(from: Date, months: number): Date {
  const next = new Date(from);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

/** The label of an amount in minor units, for the description of a line: `49.00 EUR`. */
export function money(amount: number, currency: string): string {
  const digits =
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return `${(amount / 10 ** digits).toFixed(digits)} ${currency}`;
}

/** A code as the API reads it: case and separators do not matter. */
export const normalizeCode = (code: string) => code.replace(/[^a-z0-9]/gi, "").toUpperCase();
