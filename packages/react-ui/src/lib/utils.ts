import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Class composition, with Tailwind's conflicts resolved.
 *
 * `tailwind-merge` is the largest third-party item in a styled bundle — 26.4 KB
 * minified, **8.3 KB gzip** — so it gets asked about. Measured answer, so the
 * next person does not have to re-derive it:
 *
 * **The SDK's own rendering does not depend on it.** Swapping this for bare
 * `clsx`, rebuilding Storybook and diffing the computed styles of every element
 * in all eleven snapshotted stories produced zero differences. Nothing the SDK
 * composes internally conflicts with itself.
 *
 * **What it does hold up is the override contract**, and that is public API:
 * every component takes `className`, and `appearance.elements` takes class names
 * whose entire purpose is to replace an SDK utility. Both are unbounded inputs —
 * a host may pass any class Tailwind can emit — and without conflict resolution
 * the winner is decided by the order the two rules happen to sit in the
 * generated stylesheet. `p-6` over `px-2` does not even have an order to lose
 * to: they set different properties, so the SDK's class keeps the inline axis
 * whatever the host asked for. A theming API that works for most values and
 * silently ignores the rest is worse than none.
 *
 * A trimmed config (`createTailwindMerge` with only the groups the SDK emits)
 * measures at ~2 KB and was rejected for that same reason: it resolves conflicts
 * for the families it knows, and the host side is not enumerable, so the classes
 * it does not know fail silently. The completeness is what the 8.3 KB buys.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
