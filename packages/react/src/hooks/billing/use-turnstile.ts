// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import { loadTurnstile, type TurnstileApi, type TurnstileRenderParameters } from "./turnstile.ts";

/**
 * Where the widget stands: `idle` with nothing to draw it in or nothing to check, `loading` while
 * Cloudflare's script is fetched, `solving` once the widget is drawn and has no token yet (it
 * solves itself in most cases, and asks the visitor in the others), `solved` when a token is held,
 * and `failed` when the script could not be loaded or the widget reported an error.
 *
 * A token that expires goes back to `solving`: the widget asks for a new one by itself. A minor
 * release may add a state, which takes its case from another: take one you do not know as not
 * solved.
 */
export type TurnstileStatus = "idle" | "loading" | "solving" | "solved" | "failed";

/** How the widget looks and speaks. All optional: Cloudflare's own defaults, but for the size. */
export interface TurnstileOptions {
  /**
   * `always` draws the widget as soon as it is rendered (the default), and `interaction-only` only
   * when the visitor has something to do. Cloudflare's `execute`, which waits for the page to ask,
   * is not offered: nothing here asks.
   */
  appearance?: "always" | "interaction-only";
  /** `auto` follows the visitor's system. Default `auto`. */
  theme?: "auto" | "light" | "dark";
  /**
   * `normal` is 300 px wide, `compact` 150 px, `flexible` fills its container from 300 px. Default:
   * `compact` in a container narrower than 300 px, else `normal`, chosen again when the container
   * crosses 300 px (a rotation, a drawer): the widget is then drawn again, and solves again.
   */
  size?: "normal" | "compact" | "flexible";
  /** A language code such as `fr`, or `auto` for the visitor's browser. Default `auto`. */
  language?: string;
}

export interface TurnstileWidget {
  /** The site key the widget is drawn with: the catalogue's. `null` while there is none. */
  siteKey: string | null;
  /**
   * Put this on the element the widget is drawn in: `<div ref={turnstile.ref} />`. It stays
   * mounted for as long as a token may be needed; removing it removes the widget.
   */
  ref: (element: HTMLElement | null) => void;
  status: TurnstileStatus;
  /**
   * The size the widget is drawn at, `normal` until it is known. Keep this much height for the
   * element, so that the page does not jump when the widget appears: 65 px for `normal` and
   * `flexible`, 140 px for `compact`.
   */
  size: "normal" | "compact" | "flexible";
  /** The code Cloudflare gave for a widget that failed, `null` when none was given or it did not fail. */
  errorCode: string | null;
  /** Draws the widget again after it `failed`: loads the script once more if that was what failed. */
  retry: () => void;
}

/** The widget with the hook's own doors to it: `take` and `reset`. */
export interface TurnstileControl extends TurnstileWidget {
  /**
   * The token held, if any, and gives it up: a token is single-use, so the widget is reset to
   * produce the next one. `null` when none is held.
   */
  take: () => string | null;
  /** Throws the token away and asks the widget for a new one. */
  reset: () => void;
}

/**
 * The Turnstile widget of an anonymous checkout: loads Cloudflare's script, draws the widget in the
 * element given to `ref`, and holds the token it gives.
 *
 * A token is single-use and valid for five minutes, so it is never kept longer than it takes to be
 * used: `take()` hands it over and has the widget produce another. The token is in a ref and
 * nowhere else: it is not rendered, not stored and not logged.
 */
export function useTurnstile(
  siteKey: string | null,
  options: TurnstileOptions = {},
): TurnstileControl {
  const [container, setContainer] = React.useState<HTMLElement | null>(null);
  const [status, setStatus] = React.useState<TurnstileStatus>("idle");
  const [errorCode, setErrorCode] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const token = React.useRef<string | null>(null);
  const widget = React.useRef<{ api: TurnstileApi; id: string } | null>(null);
  // How wide the container is, for a host that did not say: re-read when it is resized.
  const [measured, setMeasured] = React.useState<"compact" | "normal" | null>(null);
  const { appearance, theme, size: chosenSize, language } = options;
  const size = chosenSize ?? measured;

  React.useEffect(() => {
    if (container === null || chosenSize !== undefined) {
      setMeasured(null);
      return;
    }
    const measure = () =>
      setMeasured(container.clientWidth > 0 && container.clientWidth < 300 ? "compact" : "normal");
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [container, chosenSize]);

  React.useEffect(() => {
    token.current = null;
    if (container === null || siteKey === null || size === null) {
      setStatus("idle");
      setErrorCode(null);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setErrorCode(null);
    loadTurnstile().then(
      (api) => {
        if (cancelled) return;
        const parameters: TurnstileRenderParameters = {
          sitekey: siteKey,
          theme: theme ?? "auto",
          size,
          appearance: appearance ?? "always",
          ...(language ? { language } : {}),
          "refresh-expired": "auto",
          retry: "auto",
          callback: (value) => {
            if (cancelled) return;
            token.current = value;
            setErrorCode(null);
            setStatus("solved");
          },
          "expired-callback": () => {
            if (cancelled) return;
            token.current = null;
            setStatus("solving");
          },
          "timeout-callback": () => {
            if (cancelled) return;
            token.current = null;
            setStatus("solving");
          },
          "error-callback": (code) => {
            if (cancelled) return;
            token.current = null;
            setErrorCode(code ?? null);
            setStatus("failed");
            // Said on screen: Cloudflare need not log it as well.
            return true;
          },
        };
        let id: string | undefined;
        try {
          id = api.render(container, parameters);
        } catch (error) {
          setErrorCode(error instanceof Error ? error.message : null);
          setStatus("failed");
          return;
        }
        if (id === undefined) {
          setStatus("failed");
          return;
        }
        widget.current = { api, id };
        // A widget that answered before `render` returned has said where it stands already.
        setStatus((previous) => (previous === "loading" ? "solving" : previous));
      },
      () => {
        if (!cancelled) setStatus("failed");
      },
    );
    return () => {
      cancelled = true;
      token.current = null;
      const drawn = widget.current;
      widget.current = null;
      if (drawn) {
        try {
          drawn.api.remove(drawn.id);
        } catch {
          // A widget that is already gone has nothing to remove.
        }
      }
    };
  }, [container, siteKey, appearance, theme, size, language, attempt]);

  const reset = React.useCallback(() => {
    token.current = null;
    const drawn = widget.current;
    if (!drawn) return;
    setStatus("solving");
    try {
      drawn.api.reset(drawn.id);
    } catch {
      // The widget is gone: the effect draws it again when its container comes back.
    }
  }, []);

  const take = React.useCallback((): string | null => {
    const held = token.current;
    if (held === null) return null;
    reset();
    return held;
  }, [reset]);

  const retry = React.useCallback(() => setAttempt((count) => count + 1), []);

  return {
    siteKey,
    ref: setContainer,
    status,
    size: size ?? "normal",
    errorCode,
    retry,
    take,
    reset,
  };
}
