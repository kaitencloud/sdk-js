// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { isHttpUrl } from "@kaitencloud/react/internal";

/**
 * An address a link can safely go to: http(s), absolute or relative to this page. Anything
 * else (`javascript:`, `data:`, an address that does not parse) gives `null`, and no link.
 *
 * Without a window, as when a page renders on the server, a relative address is read against
 * an http base: the verdict is then the one a browser gives on an http(s) page, so the HTML
 * the server sends and the one the browser hydrates agree.
 */
export function safeHref(url: string | null | undefined): string | null {
  if (url === undefined || url === null || url === "") return null;
  try {
    const base = typeof window === "undefined" ? "http://localhost/" : window.location.href;
    return isHttpUrl(new URL(url, base).href) ? url : null;
  } catch {
    return null;
  }
}
