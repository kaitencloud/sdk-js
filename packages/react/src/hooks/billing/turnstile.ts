// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Cloudflare Turnstile, the way an anonymous checkout uses it: one script for the whole page,
// loaded the first time a widget is wanted, and a widget that gives one token per start.
//
// Nothing here draws, and nothing here knows Kaiten: it is the browser's half of the check, kept
// apart so that the hook of the checkout and its tests share one loader.

/**
 * Where Cloudflare serves the script. A host's Content-Security-Policy must allow
 * `https://challenges.cloudflare.com` in `script-src`, `frame-src` and `connect-src`, or the widget
 * never appears (see the README).
 */
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/** How long a script that neither loads nor fails is waited for: a network that hangs. */
const LOAD_TIMEOUT_MS = 15_000;
const POLL_MS = 50;

/** What `turnstile.render` takes, of what the checkout uses. */
export interface TurnstileRenderParameters {
  sitekey: string;
  callback?: (token: string) => void;
  "error-callback"?: (code?: string) => boolean | void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  theme?: "auto" | "light" | "dark";
  size?: "normal" | "flexible" | "compact";
  appearance?: "always" | "execute" | "interaction-only";
  language?: string;
  "refresh-expired"?: "auto" | "manual" | "never";
  retry?: "auto" | "never";
}

/** The part of `window.turnstile` the checkout calls. */
export interface TurnstileApi {
  render: (container: HTMLElement, parameters: TurnstileRenderParameters) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

const globalApi = (): TurnstileApi | undefined =>
  (globalThis as { turnstile?: TurnstileApi }).turnstile;

let loading: Promise<TurnstileApi> | null = null;

/** The `<script>` of Cloudflare that is already in the page, a host's own or an earlier load's. */
function existingScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(`script[src^="${TURNSTILE_SCRIPT_URL}"]`);
}

/**
 * The Turnstile API, loading its script once for the page.
 *
 * Every widget of every checkout on the page shares the one script: a second request waits for the
 * first. The script is asked for with `render=explicit`, so that the widget is drawn when the
 * checkout says and into the element it says, and never by Cloudflare scanning the page. A script
 * that fails, or does not answer in 15 seconds, rejects and is forgotten, so that a later call tries
 * again. One the host already put in the page is used, not loaded twice, and so is a `turnstile` the
 * page already has.
 *
 * Rejects outside a browser: there is no widget to draw on a server, and the hook asks only from an
 * effect.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
  const ready = typeof document === "undefined" ? undefined : globalApi();
  if (ready) return Promise.resolve(ready);
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Kaiten: Turnstile can only be loaded in a browser."));
  }
  if (loading) return loading;

  const attempt = new Promise<TurnstileApi>((resolve, reject) => {
    const known = existingScript();
    const script = known ?? document.createElement("script");
    let settled = false;
    const finish = (outcome: () => void, failed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      if (failed) script.remove();
      outcome();
    };
    const onLoad = () => {
      const api = globalApi();
      if (api) finish(() => resolve(api), false);
      else
        finish(
          () => reject(new Error("Kaiten: the Turnstile script did not define turnstile.")),
          true,
        );
    };
    const onError = () =>
      finish(() => reject(new Error("Kaiten: the Turnstile script could not be loaded.")), true);
    const timer = setTimeout(
      () =>
        finish(
          () => reject(new Error("Kaiten: the Turnstile script took too long to load.")),
          true,
        ),
      LOAD_TIMEOUT_MS,
    );
    // A script that is there already may have loaded before we listened: look for its API.
    const poll = setInterval(() => {
      const api = globalApi();
      if (api) finish(() => resolve(api), false);
    }, POLL_MS);

    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    if (!known) {
      script.src = `${TURNSTILE_SCRIPT_URL}?render=explicit`;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  loading = attempt;
  // Whatever the outcome, a settled load is not waited for again: a success is `window.turnstile`,
  // and a failure is tried afresh.
  const forget = () => {
    if (loading === attempt) loading = null;
  };
  attempt.then(forget, forget);
  return attempt;
}
