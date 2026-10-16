import * as React from "react";

import { useSetAddonQuantity, type AddonQuantityProblem } from "@kaitencloud/react/billing";
import {
  formatKaitenPrice,
  useLocalization,
  usePortal,
  type Addon,
  type KaitenPortalBillingWords,
} from "@kaitencloud/react";
import { useKaitenDataContext } from "@kaitencloud/react/internal";

import { useMergedAppearance } from "../../../appearance/context.tsx";
import type { KaitenAppearance } from "../../../appearance/types.ts";
import { cn } from "../../../lib/utils.ts";
import { addonUnitPrice, attachableTo, saleOfSubscription } from "../../shared/addon-fee.ts";
import { usePortalBillingWords } from "../../shared/billing-words.ts";
import { Action, Message } from "../../shared/feedback.tsx";
import { useFocusScope } from "../../shared/focus.ts";
import { KaitenBranding } from "../../shared/kaiten-branding.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { getAddonDisplayPrice } from "./addon-price.ts";

interface Row {
  addon: Addon;
  quantity: number;
  max: number | null;
}

/** What the section says of a refused change: why, when the API said why, and what to do. */
function refusalText(problem: AddonQuantityProblem, words: KaitenPortalBillingWords): string {
  switch (problem.kind) {
    case "currency_mismatch":
      return words.addonCurrencyMismatch;
    case "incompatible":
      return words.addonIncompatible;
    case "quantity_exceeds_max":
      return words.addonQuantityExceedsMax;
    case "other_version_attached":
      return words.addonOtherVersionAttached;
    case "subscription_incomplete":
      return words.addonSubscriptionIncomplete;
    case "boundary_pending":
      return words.stillClosing;
    case "unavailable":
      return words.unavailable;
    default:
      return words.actionFailed;
  }
}

/**
 * The add-ons of a customer session, with the controls to change how many it holds: the ones the
 * instance holds, and the public add-ons of the catalogue that fit its plan and that Kaiten attaches
 * to its subscription, when the provider reads the catalogue. An add-on set to none leaves
 * the portal, so one that was seen stays on screen for as long as the section does, and can be
 * added back.
 *
 * Each press is one change: the quantity is the server's to set, `0` detaching it, and a refusal is
 * the answer, said with its reason: an add-on in another currency, one that does not fit the plan,
 * too many units, another version held, a plan that waits for its payment. A change is billed from
 * the next renewal, with nothing refunded, which is said before the last unit is removed. While a
 * billing period is being closed the API asks to wait, and the hook does: the section says so.
 */
export function SessionAddOns({
  appearance,
  unstyled = false,
}: {
  appearance?: KaitenAppearance;
  unstyled?: boolean;
}) {
  const merged = useMergedAppearance(appearance);
  const localization = useLocalization();
  const words = usePortalBillingWords();
  const portal = usePortal();
  const catalog = useKaitenDataContext().catalog.data;
  const change = useSetAddonQuantity();
  const scope = useFocusScope();

  const [confirming, setConfirming] = React.useState<string | null>(null);
  const seen = React.useRef(new Map<string, Addon>());

  const data = portal.data;
  const subscription = data?.subscription ?? null;

  const rows = React.useMemo<Row[]>(() => {
    if (!data) return [];
    const plan = catalog?.plans.find((candidate) => candidate.slug === data.instance?.licenseSlug);
    // A live subscription is offered only what Kaiten attaches to it: an add-on priced in its
    // currency and, for a paid one with flat fees, with a default fee for its billing period.
    // Without one, nothing is billed and nothing is checked.
    const live = subscription && subscription.status !== "CANCELED" ? subscription : null;
    const sale = live ? saleOfSubscription(live) : null;
    const offered = (catalog?.addOns ?? []).filter(
      (addon) =>
        !!addon.familySlug &&
        !!plan?.compatibleAddonFamilies?.includes(addon.familySlug) &&
        (sale === null || attachableTo(addon, sale)),
    );
    const held = new Map(data.addOns.map((addon) => [addon.slug, addon] as const));
    for (const addon of data.addOns) seen.current.set(addon.slug, addon);
    const all = new Map<string, Addon>();
    for (const addon of data.addOns) all.set(addon.slug, addon);
    for (const addon of offered) if (!all.has(addon.slug)) all.set(addon.slug, addon);
    for (const [slug, addon] of seen.current) if (!all.has(slug)) all.set(slug, addon);
    return [...all.values()].map((addon) => ({
      addon,
      quantity: held.get(addon.slug)?.quantity ?? 0,
      max: addon.maxQuantity ?? null,
    }));
  }, [data, catalog, subscription]);

  if (portal.isLoading) {
    return (
      <Card className={cn(merged.elements?.card)} aria-busy="true">
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
        <KaitenBranding className="-mb-6" />
      </Card>
    );
  }
  // An unbound session has no instance to attach anything to.
  if (!data?.instance || rows.length === 0) return null;

  const busy = change.isPending;
  // The last change's refusal, until the next change is sent.
  const failure = change.problem ? refusalText(change.problem, words) : null;

  const setQuantity = async (row: Row, quantity: number) => {
    // The question stays up while its answer is sent: it is what the keyboard is on.
    if (quantity !== 0) setConfirming(null);
    try {
      await change.mutateAsync({ addonSlug: row.addon.slug, quantity });
    } catch {
      // Refused: the hook's `problem` says with what, and the section says it.
    }
    if (quantity === 0) {
      // The question is over and the row is at none: the keyboard goes to adding one back.
      setConfirming(null);
      scope.focus(`more-${row.addon.slug}`, `less-${row.addon.slug}`);
    }
  };

  const priceOf = (addon: Addon) => {
    const fee = addonUnitPrice(addon, subscription ? saleOfSubscription(subscription) : null);
    if (fee) return formatKaitenPrice(fee, localization);
    const shown = getAddonDisplayPrice(addon);
    return shown
      ? `${localization.formatMoney(shown.amount, shown.currencyCode)}/${shown.interval}`
      : null;
  };

  const feedback = (
    <div data-slot="addons-feedback" className="ktn-own">
      {change.retryAt !== null ? (
        <Message unstyled={unstyled} tone="info" text={words.closingPeriod} busy />
      ) : null}
      {failure ? <Message unstyled={unstyled} tone="error" text={failure} /> : null}
    </div>
  );

  if (unstyled) {
    return (
      <section ref={scope.ref} data-slot="addons" className="ktn-own">
        <h3>{localization.addOns.title}</h3>
        <ul>
          {rows.map((row) => (
            <li key={row.addon.slug}>
              <span>{row.addon.name}</span>{" "}
              <button
                type="button"
                aria-label={words.addonLess(row.addon.name)}
                aria-disabled={busy || row.quantity <= 0 || undefined}
                data-focus={`less-${row.addon.slug}`}
                onClick={() => {
                  if (busy || row.quantity <= 0) return;
                  if (row.quantity === 1) {
                    setConfirming(row.addon.slug);
                    scope.focus(`remove-prompt-${row.addon.slug}`);
                  } else void setQuantity(row, row.quantity - 1);
                }}
              >
                −
              </button>
              <output aria-label={words.addonQuantity(row.addon.name)}>{row.quantity}</output>
              <button
                type="button"
                aria-label={words.addonMore(row.addon.name)}
                aria-disabled={busy || (row.max !== null && row.quantity >= row.max) || undefined}
                data-focus={`more-${row.addon.slug}`}
                onClick={() => {
                  if (busy || (row.max !== null && row.quantity >= row.max)) return;
                  void setQuantity(row, row.quantity + 1);
                }}
              >
                +
              </button>
              {confirming === row.addon.slug ? (
                <div role="group" aria-label={words.addonRemovePrompt(row.addon.name)}>
                  <p data-focus={`remove-prompt-${row.addon.slug}`} tabIndex={-1}>
                    {words.addonRemovePrompt(row.addon.name)}
                  </p>
                  <p>{words.addonRemoveNote}</p>
                  <button
                    type="button"
                    aria-disabled={busy || undefined}
                    onClick={() => {
                      if (!busy) void setQuantity(row, 0);
                    }}
                  >
                    {words.addonRemove}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(null);
                      scope.focus(`less-${row.addon.slug}`);
                    }}
                  >
                    {words.addonKeep}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {feedback}
      </section>
    );
  }

  return (
    <Card className={cn(merged.elements?.card)}>
      <CardHeader className={cn(merged.elements?.cardHeader)}>
        <CardTitle className={cn(merged.elements?.cardTitle)}>
          {localization.addOns.title}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn("grid gap-3", merged.elements?.cardContent)}>
        <div ref={scope.ref} className="ktn-own contents">
          {rows.map((row) => {
            const price = priceOf(row.addon);
            return (
              <div
                key={row.addon.slug}
                data-slot="addon"
                className="ktn-own flex flex-col gap-3 rounded-ktn-lg border border-ktn-border p-4"
              >
                <div className="ktn-own flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                  <div className="ktn-own flex min-w-0 flex-col gap-1">
                    <span className="ktn-own font-medium break-words">{row.addon.name}</span>
                    {row.addon.description ? (
                      <span className="ktn-own text-sm text-ktn-muted-foreground">
                        {row.addon.description}
                      </span>
                    ) : null}
                    <span className="ktn-own text-xs text-ktn-muted-foreground">
                      {[price, row.max !== null ? words.addonUpTo(row.max.toLocaleString()) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <div className="ktn-own flex items-center gap-2" aria-busy={busy || undefined}>
                    <Action
                      unstyled={false}
                      variant="outline"
                      label={words.addonLess(row.addon.name)}
                      busy={busy || row.quantity <= 0}
                      focusKey={`less-${row.addon.slug}`}
                      onClick={() => {
                        if (row.quantity === 1) {
                          setConfirming(row.addon.slug);
                          scope.focus(`remove-prompt-${row.addon.slug}`);
                        } else void setQuantity(row, row.quantity - 1);
                      }}
                    >
                      −
                    </Action>
                    <output
                      aria-label={words.addonQuantity(row.addon.name)}
                      className="ktn-own min-w-6 text-center font-mono text-sm"
                    >
                      {row.quantity}
                    </output>
                    <Action
                      unstyled={false}
                      variant="outline"
                      label={words.addonMore(row.addon.name)}
                      busy={busy || (row.max !== null && row.quantity >= row.max)}
                      focusKey={`more-${row.addon.slug}`}
                      onClick={() => void setQuantity(row, row.quantity + 1)}
                    >
                      +
                    </Action>
                  </div>
                </div>
                {confirming === row.addon.slug ? (
                  <div
                    role="group"
                    aria-label={words.addonRemovePrompt(row.addon.name)}
                    className="ktn-own flex flex-col gap-3 rounded-lg border bg-card p-3"
                  >
                    <p
                      data-focus={`remove-prompt-${row.addon.slug}`}
                      tabIndex={-1}
                      className="ktn-own text-sm font-medium"
                    >
                      {words.addonRemovePrompt(row.addon.name)}
                    </p>
                    <p className="ktn-own text-xs text-ktn-muted-foreground">
                      {words.addonRemoveNote}
                    </p>
                    <div className="ktn-own flex flex-wrap gap-2">
                      <Action
                        unstyled={false}
                        variant="default"
                        size="sm"
                        busy={busy}
                        onClick={() => void setQuantity(row, 0)}
                      >
                        {words.addonRemove}
                      </Action>
                      <Action
                        unstyled={false}
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setConfirming(null);
                          scope.focus(`less-${row.addon.slug}`);
                        }}
                      >
                        {words.addonKeep}
                      </Action>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {feedback}
        </div>
      </CardContent>
      <KaitenBranding className="-mb-6" />
    </Card>
  );
}
