// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import {
  useCheckoutPreview,
  type CheckoutPreviewSelection,
  type CheckoutProblem,
  type CheckoutPreviewState,
} from "@kaitencloud/react/billing";
import { useLocalization, usePortal, type Addon } from "@kaitencloud/react";
import { useKaitenDataContext, useTrackComponent } from "@kaitencloud/react/internal";

import { useIcons } from "../../appearance/icons.tsx";
import { useMergedAppearance } from "../../appearance/context.tsx";
import type { KaitenAppearance } from "../../appearance/types.ts";
import { cn } from "../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { KaitenBranding } from "../shared/kaiten-branding.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
import { Separator } from "../ui/separator.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { useCheckoutWords } from "./words.ts";

/** What to price: the same choices a checkout is made of, none of them needed but the price. */
export interface CheckoutSummarySelection extends Partial<
  Omit<CheckoutPreviewSelection, "licensePriceId">
> {
  /** The id of the price being bought (`BillingPrice.id`). `null` prices nothing. */
  licensePriceId: string | null;
}

export interface CheckoutSummaryProps {
  /**
   * What to price. The server is asked what is due today for it (a checkout's `dryRun`) once
   * it has stood still for 300 ms, and the summary shows its lines and its total as they are:
   * nothing is added up here.
   */
  selection?: CheckoutSummarySelection;
  /**
   * A preview that something else already holds (`useCheckoutPreview`, or `useCheckout`'s
   * `preview`), shown instead of asking for one. `selection` is not read then.
   */
  preview?: CheckoutPreviewState;
  appearance?: KaitenAppearance;
  unstyled?: boolean;
}

/**
 * What is due today for a selection, as the server computed it: its lines, and the total it
 * says, which need not be their sum. A trial is "€0.00 today" and the day it ends. Needs
 * `mode="customer-session"`.
 *
 * A request is made when the selection stops changing, so a stepper that is pressed three
 * times is one; the summary on screen is kept, dimmed, until the answer comes. A voucher the
 * server refuses leaves the summary it had, and a plan the instance is over is refused with the
 * entitlements that are.
 *
 * @experimental Styled component — shape may change in a minor release (see STABILITY.md); prefer `unstyled` mode or the headless hooks for the stable path.
 */
export function CheckoutSummary({
  selection,
  preview,
  appearance,
  unstyled = false,
}: CheckoutSummaryProps) {
  useAssertWrappedByKaitenProvider("CheckoutSummary");
  useTrackComponent("CheckoutSummary");

  const merged = useMergedAppearance(appearance);
  const words = useCheckoutWords();
  const own = useCheckoutPreview(
    preview || !selection
      ? null
      : {
          licensePriceId: selection.licensePriceId,
          addOns: selection.addOns ?? {},
          voucherCode: selection.voucherCode ?? "",
          skipTrial: selection.skipTrial ?? false,
          billingEmail: selection.billingEmail ?? "",
        },
  );
  const shown = preview ?? own;

  if (unstyled) {
    return (
      <section data-slot="checkout-summary" className="ktn-own">
        <h3>{words.summary}</h3>
        <CheckoutSummaryBody preview={shown} unstyled />
        <KaitenBranding unstyled />
      </section>
    );
  }

  // `w-[min(100%,32rem)]` says "fill the slot, but never wider than 32rem": a floor keyed to the
  // window would impose its width on a slot narrower than itself.
  return (
    <div data-slot="checkout-summary" className="ktn-own w-[min(100%,32rem)]">
      <Card className={cn(merged.elements?.card)}>
        <CardHeader className={cn(merged.elements?.cardHeader)}>
          <CardTitle className={cn(merged.elements?.cardTitle)}>{words.summary}</CardTitle>
        </CardHeader>
        <CardContent className={cn(merged.elements?.cardContent)}>
          <CheckoutSummaryBody preview={shown} />
        </CardContent>
        <KaitenBranding className="-mb-6" />
      </Card>
    </div>
  );
}

/** The names a refusal gives the entitlements it names: the portal's when it has them, else the slugs. */
export function useEntitlementNames(): (slug: string) => string {
  const portal = usePortal().data;
  return React.useCallback(
    (slug: string) =>
      portal?.entitlements.find((entitlement) => entitlement.slug === slug)?.name ?? slug,
    [portal],
  );
}

/**
 * The names a refusal gives the add-ons it names: the portal's for one the instance holds, else
 * those the host gave, else the catalogue's, else the slug.
 */
function useAddOnNames(offered: readonly Addon[] | undefined): (slug: string) => string {
  const held = usePortal().data?.addOns;
  const sold = useKaitenDataContext().catalog.data?.addOns;
  return React.useCallback(
    (slug: string) =>
      [held, offered, sold]
        .map((addOns) => addOns?.find((addon) => addon.slug === slug)?.name)
        .find((name) => name !== undefined) ?? slug,
    [held, offered, sold],
  );
}

/**
 * Whether asking again for a refused preview can help, kind by kind: `false` for a refusal that
 * asking again would only repeat, because the selection, the customer or the vendor has to change
 * first. Every kind is listed, so a kind added to `CheckoutProblem` stops this package from
 * compiling until it is classified here. A kind that a later `@kaitencloud/react` adds beside a
 * published `@kaitencloud/react-ui` is not listed, and is offered a retry, as `other` is: it names
 * what was `other` until then.
 */
const RETRIES: Readonly<Record<CheckoutProblem["kind"], boolean>> = {
  quota_exceeded: false,
  billing_email_required: false,
  voucher_invalid: false,
  already_subscribed: false,
  setup_incomplete: false,
  unavailable: true,
  rate_limited: true,
  not_payable_online: false,
  addon_refused: false,
  other: true,
};

/**
 * What a refusal says to a customer, for the ones that have words. Anything else is the generic
 * error. A voucher is worded by its own field, so the refusal of one is not worded here. `addOns`
 * are add-ons the host handed a flow, whose names a refusal of them says.
 */
export function useProblemText(
  addOns?: readonly Addon[],
): (problem: CheckoutProblem | null) => string {
  const words = useCheckoutWords();
  const nameOf = useEntitlementNames();
  const addOnName = useAddOnNames(addOns);
  return React.useCallback(
    (problem) => {
      switch (problem?.kind) {
        case "addon_refused": {
          // The refusal the customer can act on first: an add-on of a family they hold, which the
          // checkout should not have ordered, then a billing period that cannot bill what they
          // hold, which another period can.
          const names = (reason?: string, held?: boolean) =>
            problem.addOns
              .filter(
                (each) =>
                  (reason === undefined || each.reason === reason) &&
                  (held === undefined || each.held === held),
              )
              .map((each) => addOnName(each.slug))
              .join(", ");
          if (names("family_held")) return words.addOnAlreadyHeld(names("family_held"));
          if (names("no_price_for_period", true)) {
            return words.addOnNotForPeriod(names("no_price_for_period", true));
          }
          return words.addOnRefused(names());
        }
        case "quota_exceeded":
          return words.quotaExceeded(problem.entitlementSlugs.map(nameOf).join(", "));
        case "unavailable":
          return words.unavailable;
        case "rate_limited":
          return words.rateLimited;
        case "not_payable_online":
          return words.notSold;
        case "voucher_invalid":
          return words.voucherInvalid;
        case "already_subscribed":
          return words.alreadySubscribed;
        case "setup_incomplete":
          return words.setupIncomplete;
        default:
          return words.error;
      }
    },
    [words, nameOf, addOnName],
  );
}

export interface CheckoutSummaryBodyProps {
  preview: CheckoutPreviewState;
  unstyled?: boolean;
  /** Add-ons the host handed the flow: a refusal of one says the name given there. */
  addOns?: readonly Addon[];
  /**
   * Whether a line says the server's arithmetic under its name ("1 × 49.00 EUR"), which is written
   * in the server's own format. Default `true`. A screen that words the price itself, in the host's
   * money format, leaves it out so that the two are not both on the card.
   */
  lineDetail?: boolean;
}

/**
 * The lines, the total and what stands in their place: the part of a summary that a checkout
 * flow draws inside its own card. It says what it can about a refusal the flow does not
 * word itself.
 */
export function CheckoutSummaryBody({
  preview,
  unstyled = false,
  addOns,
  lineDetail = true,
}: CheckoutSummaryBodyProps) {
  const localization = useLocalization();
  const words = useCheckoutWords();
  const problemText = useProblemText(addOns);
  const icons = useIcons();
  const AlertIcon = icons.alertTriangle;
  const { data, problem } = preview;

  const refusal =
    problem?.kind === "addon_refused" ||
    problem?.kind === "quota_exceeded" ||
    problem?.kind === "unavailable" ||
    problem?.kind === "rate_limited" ||
    problem?.kind === "not_payable_online" ||
    problem?.kind === "already_subscribed"
      ? problemText(problem)
      : preview.error
        ? localization.states.failed
        : null;
  // A refusal of the selection that is on screen, said in place of its lines.
  const alert = refusal ? (
    <div
      role="alert"
      className={cn(
        "ktn-own",
        unstyled
          ? undefined
          : "flex items-start gap-2 rounded-lg border border-destructive-subtle-foreground/30 bg-destructive-subtle p-3 text-sm text-destructive-subtle-foreground",
      )}
      data-slot="checkout-summary-error"
    >
      {unstyled ? null : <AlertIcon className="mt-0.5 size-4 shrink-0" />}
      <span>{refusal}</span>
      {preview.error && (problem === null || RETRIES[problem.kind] !== false) ? (
        unstyled ? (
          <button type="button" onClick={preview.retry}>
            {localization.states.retry}
          </button>
        ) : (
          <Button variant="outline" size="xs" className="ml-auto" onClick={preview.retry}>
            {localization.states.retry}
          </Button>
        )
      ) : null}
    </div>
  ) : null;

  if (preview.status === "idle") {
    return unstyled ? (
      <p data-slot="checkout-summary-empty" className="ktn-own">
        {words.choosePrice}
      </p>
    ) : (
      <p data-slot="checkout-summary-empty" className="ktn-own text-sm text-ktn-muted-foreground">
        {words.choosePrice}
      </p>
    );
  }

  // A refused selection has no lines of its own, and those of another one would say what this
  // one does not cost: the refusal stands alone.
  if (data === null || (alert && preview.status === "failed")) {
    if (alert) return alert;
    // Asked for, not answered yet.
    return unstyled ? (
      <p data-slot="checkout-summary-loading" aria-busy="true" className="ktn-own">
        {localization.states.loading}
      </p>
    ) : (
      <div
        data-slot="checkout-summary-loading"
        aria-busy="true"
        className="ktn-own flex flex-col gap-3"
      >
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-6 w-1/2 self-end" />
      </div>
    );
  }

  const { dueToday, trialEndsAt } = data;
  const money = (amount: number) => localization.formatMoney(amount, dueToday.currencyCode);
  const trial = trialEndsAt !== null;
  const total = trial ? words.todayAmount(money(dueToday.total)) : money(dueToday.total);

  if (unstyled) {
    return (
      <div data-slot="checkout-summary-lines" aria-busy={preview.isStale} className="ktn-own">
        {alert}
        <ul>
          {dueToday.lines.map((line) => (
            <li key={line.seq}>
              {line.label}
              {lineDetail && line.description ? ` (${line.description})` : ""}: {money(line.amount)}
            </li>
          ))}
        </ul>
        <p role="status">
          {trial ? null : `${words.dueToday}: `}
          {total}
        </p>
        {trial ? <p>{words.trialEndsOn(trialEndsAt)}</p> : null}
      </div>
    );
  }

  return (
    <div
      data-slot="checkout-summary-lines"
      aria-busy={preview.isStale}
      className={cn("ktn-own flex flex-col gap-3", preview.isStale && "opacity-60")}
    >
      {alert}
      {dueToday.lines.map((line) => (
        <div key={line.seq} className="flex items-start justify-between gap-4 text-sm">
          <div className="flex min-w-0 flex-col">
            <span className="break-words">{line.label}</span>
            {lineDetail && line.description ? (
              <span className="text-xs break-words text-ktn-muted-foreground">
                {line.description}
              </span>
            ) : null}
          </div>
          <span className="shrink-0 font-mono">{money(line.amount)}</span>
        </div>
      ))}
      {dueToday.lines.length > 0 ? <Separator className="my-1" /> : null}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-medium">
        {trial ? null : <span>{words.dueToday}</span>}
        <span role="status" className={cn("font-mono", trial ? "text-lg" : "ml-auto")}>
          {total}
        </span>
      </div>
      {trial ? (
        <p className="text-sm text-ktn-muted-foreground">{words.trialEndsOn(trialEndsAt)}</p>
      ) : null}
    </div>
  );
}
