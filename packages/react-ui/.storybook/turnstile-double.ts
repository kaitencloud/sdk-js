// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// A stand-in for Cloudflare's Turnstile script, for stories and tests that must run with no network and
// no challenge to solve. It defines `window.turnstile`, which the checkout finds and uses instead of
// loading the script, and draws a small widget of its own where Turnstile would draw its frame.
//
// It plays what Turnstile's published test keys do: `1x00000000000000000000AA` always passes,
// `2x00000000000000000000AB` always blocks, `3x00000000000000000000FF` asks the visitor to interact.
// The site key given to the widget decides, as it does at Cloudflare, unless the story says
// otherwise.

/** The part of what `turnstile.render` takes that the stand-in plays. */
interface RenderParameters {
  sitekey: string;
  callback?: (token: string) => void;
  "error-callback"?: (code?: string) => boolean | void;
}

/** The part of `window.turnstile` the checkout calls. */
interface TurnstileApi {
  render: (container: HTMLElement, parameters: RenderParameters) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

/** Cloudflare's test site keys, each with the behaviour it is documented to have. */
export const TURNSTILE_TEST_KEYS = {
  alwaysPasses: "1x00000000000000000000AA",
  alwaysBlocks: "2x00000000000000000000AB",
  forcesInteraction: "3x00000000000000000000FF",
} as const;

export type TurnstileBehaviour = "passes" | "blocks" | "interactive" | "never";

const BEHAVIOUR_OF_KEY: Record<string, TurnstileBehaviour> = {
  [TURNSTILE_TEST_KEYS.alwaysPasses]: "passes",
  [TURNSTILE_TEST_KEYS.alwaysBlocks]: "blocks",
  [TURNSTILE_TEST_KEYS.forcesInteraction]: "interactive",
};

interface Drawn {
  id: string;
  container: HTMLElement;
  parameters: RenderParameters;
  frame: HTMLElement;
  draw: () => void;
}

/**
 * Installs the stand-in, and returns what takes it away. `behaviour` overrides the one the site key
 * names. Tokens are `story-turnstile-token-<n>`: single-use in spirit, a new one per solve.
 */
export function installTurnstileDouble(behaviour?: TurnstileBehaviour): () => void {
  const drawn: Drawn[] = [];
  let tokens = 0;

  const frameOf = () => {
    const frame = document.createElement("div");
    frame.dataset["slot"] = "turnstile-double";
    frame.style.cssText =
      "box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;max-width:300px;min-height:65px;padding:0 12px;border:1px solid #6b7280;border-radius:4px;background:#fafafa;color:#1f2937;font:14px/1.4 system-ui,sans-serif";
    return frame;
  };

  const api: TurnstileApi = {
    render(container, parameters) {
      const id = `story-widget-${drawn.length + 1}`;
      const frame = frameOf();
      container.replaceChildren(frame);
      const mode = behaviour ?? BEHAVIOUR_OF_KEY[parameters.sitekey] ?? "passes";
      const widget: Drawn = {
        id,
        container,
        parameters,
        frame,
        draw: () => {
          if (mode === "never") {
            frame.textContent = "Verifying...";
            return;
          }
          if (mode === "blocks") {
            frame.textContent = "Verification failed.";
            queueMicrotask(() => parameters["error-callback"]?.("600010"));
            return;
          }
          if (mode === "interactive") {
            frame.textContent = "";
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = "Verify you are human";
            button.style.cssText =
              "padding:6px 10px;border:1px solid #1f2937;border-radius:4px;background:#fff;color:#1f2937;cursor:pointer";
            button.addEventListener("click", () => {
              frame.textContent = "Success!";
              parameters.callback?.(`story-turnstile-token-${++tokens}`);
            });
            frame.append(button);
            return;
          }
          frame.textContent = "Success!";
          queueMicrotask(() => parameters.callback?.(`story-turnstile-token-${++tokens}`));
        },
      };
      drawn.push(widget);
      widget.draw();
      return id;
    },
    reset(id) {
      drawn.find((each) => each.id === id)?.draw();
    },
    remove(id) {
      const widget = drawn.find((each) => each.id === id);
      widget?.frame.remove();
    },
  };

  (globalThis as { turnstile?: TurnstileApi }).turnstile = api;
  return () => {
    if ((globalThis as { turnstile?: TurnstileApi }).turnstile === api) {
      delete (globalThis as { turnstile?: TurnstileApi }).turnstile;
    }
  };
}
