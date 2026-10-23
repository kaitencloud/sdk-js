// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// A stand-in for Cloudflare's Turnstile script, for tests that run with no network. The checkout loads
// `https://challenges.cloudflare.com/turnstile/v0/api.js` itself; a test answers that request with this
// script instead, which defines `window.turnstile` and plays the site key the stand-in for Kaiten hands the
// page, Cloudflare's published test key that always passes: the widget solves itself, with no challenge, and
// gives a token. Whether Kaiten accepts the token is the stand-in for Kaiten's to say (`standIn.turnstile`).
// Every token is a new one, in every page and every load of it: a token is single-use, and the stand-in for
// Kaiten refuses one it has seen, as Cloudflare does.

import type { BrowserContext } from "@playwright/test";

/** Where the checkout loads the script from, whatever its query. */
export const TURNSTILE_SCRIPT =
  /^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js(\?.*)?$/;

const SCRIPT = `
(() => {
  const drawn = new Map();
  let widgets = 0;
  let tokens = 0;
  const load = Math.random().toString(36).slice(2, 10);
  const solve = (id) => {
    const widget = drawn.get(id);
    if (!widget) return;
    widget.frame.textContent = "Success!";
    setTimeout(() => widget.parameters.callback && widget.parameters.callback("XXXX.DUMMY.TOKEN." + load + "." + (++tokens)), 0);
  };
  window.turnstile = {
    render(container, parameters) {
      const id = "cloudflare-stand-in-" + (++widgets);
      const frame = document.createElement("div");
      frame.dataset.testid = "turnstile-stand-in";
      frame.style.cssText = "box-sizing:border-box;max-width:300px;min-height:65px;padding:20px 12px;border:1px solid #6b7280;border-radius:4px";
      container.replaceChildren(frame);
      drawn.set(id, { parameters, frame });
      solve(id);
      return id;
    },
    reset(id) { solve(id); },
    remove(id) { const widget = drawn.get(id); if (widget) widget.frame.remove(); drawn.delete(id); },
  };
})();
`;

/** Answers Cloudflare's script, in every page of the context, with the stand-in. */
export async function standInForCloudflare(context: BrowserContext): Promise<void> {
  await context.route(TURNSTILE_SCRIPT, (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: SCRIPT }),
  );
}
