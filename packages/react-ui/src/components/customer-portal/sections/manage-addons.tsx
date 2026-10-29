// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import { useSetAddonQuantity, type AddonQuantityProblem } from "@kaitencloud/react/billing";
import {
  formatKaitenPrice,
  useLocalization,
  type KaitenPortalBillingWords,
  type PortalSubscription,
} from "@kaitencloud/react";

import { addonFeeFor, saleOfPrice, type AddonSale } from "../../shared/addon-fee.ts";
import { cn } from "../../../lib/utils.ts";
import { usePortalBillingWords } from "../../shared/billing-words.ts";
import { Action, Message } from "../../shared/feedback.tsx";
import { billingTimingText, grantDescription } from "../../shared/grant-description.ts";
import { Dialog, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import type { AddOnsPanel } from "./addons-panel-state.ts";
import {
  pendingAddonText,
  unitPriceText,
  type SessionAddonRow,
  type SessionAddOns,
} from "./session-addon-rows.ts";

/** What the panel says of a refused change: why, when the API said why, and what to do. */
function refusalText(problem: AddonQuantityProblem, words: KaitenPortalBillingWords): string {
  switch (problem.kind) {
    case "addon_not_public":
      return words.addonNotPublic;
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
    case "instance_required":
      return words.addonInstanceRequired;
    case "boundary_pending":
      return words.stillClosing;
    case "unavailable":
      return words.unavailable;
    default:
      return words.actionFailed;
  }
}

/**
 * When a change is billed, as the contract the SDK targets bills it: an increase from the next
 * boundary. A lower quantity or removal on a live subscription waits for that boundary.
 * Nothing is said of a decrease on an older server that omits pendingQuantity. A trial is never billed for the time it lasts: the invoice at its end bills
 * what is held then, and nothing if it ends without converting. A subscription that ends renews
 * nothing, and without a live one nothing is billed.
 */
function whenText(
  row: SessionAddonRow,
  to: number,
  live: PortalSubscription | null,
  words: KaitenPortalBillingWords,
): string | null {
  if (!live) return words.addonUnbilled;
  if (!["TRIAL", "ACTIVE", "PAST_DUE"].includes(live.status)) return null;
  if (to === row.quantity) return words.addonKeepQuantity ?? null;
  if (to < row.quantity) {
    if (row.addon.pendingQuantity === undefined) return null;
    return to === 0
      ? words.addonRemovedFrom(live.currentPeriodEnd)
      : words.addonLowerFrom(live.currentPeriodEnd);
  }
  if (live.status === "TRIAL") {
    const end = live.trialEndsAt ?? live.currentPeriodEnd;
    return words.addonBilledFromTrialEnd(end);
  }
  if (live.cancelAtPeriodEnd) return words.addonEnding(live.currentPeriodEnd);
  return words.addonBilledFrom(live.currentPeriodEnd);
}

/**
 * What the renewal a change is billed from bills an add-on beside, when a plan change scheduled for
 * it is in another billing period: the scheduled price's sale. `null` when none is, and for a
 * trial or a subscription that ends, which renew nothing.
 */
function renewalSale(live: PortalSubscription | null): AddonSale | null {
  const change = live?.scheduledChange;
  if (!live || !change || live.status === "TRIAL" || live.cancelAtPeriodEnd) return null;
  return Date.parse(change.effectiveAt) === Date.parse(live.currentPeriodEnd)
    ? saleOfPrice(change.price)
    : null;
}

/**
 * The way into the add-ons panel of a customer session: a button that opens it, and once the
 * changes made in it all went through, a sentence that says so, on a line of its own. The button is
 * there when the instance holds an add-on or is offered one; the panel and the sentence stay while
 * they are on screen, whatever the add-ons have become, and the sentence is said by one entry point
 * of the scope at a time (see `useAddOnsPanel`, which the component that renders this one holds).
 *
 * `inRow` puts the button in the row of actions it is rendered in, beside the others, instead of in
 * a row of its own.
 */
export function ManageAddOns({
  addOns,
  panel,
  unstyled,
  inRow = false,
}: {
  addOns: SessionAddOns;
  panel: AddOnsPanel;
  unstyled: boolean;
  inRow?: boolean;
}) {
  const words = usePortalBillingWords();
  const root = React.useRef<HTMLDivElement>(null);
  const opener = addOns.rows.length > 0;

  // The changes went through and took the last add-on with them, and the button that opened the
  // panel with it: the keyboard goes to the sentence that says so, unless it has moved on.
  React.useEffect(() => {
    if (!panel.updated || opener) return;
    const active = document.activeElement;
    const container = root.current;
    if (!container) return;
    if (active && active !== document.body && !container.contains(active)) return;
    container.querySelector<HTMLElement>('[data-focus="addons-updated"]')?.focus();
  }, [panel.updated, opener]);

  if (!opener && !panel.active) return null;

  // A checkout that waits for its payment: Kaiten changes no add-on until it is paid, so there is
  // nothing to open, only that to say.
  if (addOns.live?.status === "INCOMPLETE") {
    return (
      <div data-slot="manage-addons" className={unstyled ? undefined : "ktn-own basis-full"}>
        <Message unstyled={unstyled} tone="muted" text={words.addonSubscriptionIncomplete} />
      </div>
    );
  }

  return (
    <div
      ref={root}
      data-slot="manage-addons"
      className={
        unstyled
          ? undefined
          : inRow
            ? "ktn-own contents"
            : "ktn-own flex flex-wrap items-center gap-3"
      }
    >
      {opener ? (
        <Action unstyled={unstyled} variant="outline" size="sm" onClick={panel.show}>
          {words.addonsManage}
        </Action>
      ) : null}
      {panel.updated ? (
        <div className={unstyled ? undefined : "ktn-own basis-full"}>
          <Message
            unstyled={unstyled}
            tone="success"
            text={words.addonsUpdated}
            focusKey="addons-updated"
          />
        </div>
      ) : null}
      {panel.open ? (
        <ManageAddOnsPanel addOns={addOns} unstyled={unstyled} onClose={panel.hide} />
      ) : null}
    </div>
  );
}

interface Change {
  row: SessionAddonRow;
  to: number;
}

/**
 * The add-ons panel: a modal, on the native `<dialog>`, where the customer sets how many units of
 * each add-on the instance will hold, among the ones it holds and the ones the portal offers. What
 * they set stays in the panel, and a summary says, for each add-on they changed, the change, its
 * recurring fee at the add-on's own price and when it is billed. No amount is added up: what a
 * renewal comes to is the server's to say.
 *
 * "Confirm" sends one change per add-on, in the order of the list, and stops at the first the API
 * refuses, which it says with its reason; the changes before it went through, so the summary then
 * holds the rest. Each change reads the portal again before the next is sent. A billing period
 * being closed is waited out once, as the hook does, and said. "Cancel", Escape and the close of
 * the dialog drop what is not sent; one closed while changes are sent sends no further one.
 */
function ManageAddOnsPanel({
  addOns,
  unstyled,
  onClose,
}: {
  addOns: SessionAddOns;
  unstyled: boolean;
  /** `done` when every change went through. */
  onClose: (done: boolean) => void;
}) {
  const words = usePortalBillingWords();
  const localization = useLocalization();
  const change = useSetAddonQuantity();
  const [wanted, setWanted] = React.useState<ReadonlyMap<string, number>>(() => new Map());
  const [sending, setSending] = React.useState(false);
  const [refused, setRefused] = React.useState<string | null>(null);
  // Closed, or gone with the screen: a sequence under way sends nothing more.
  const closed = React.useRef(false);
  const inFlight = React.useRef(false);
  const summaryId = React.useId();
  const content = React.useRef<HTMLDivElement>(null);

  // The browser gives a modal's focus to its first control, which can be the − of an add-on at
  // none, out of use: the keyboard starts on the first control that is not. This runs after the
  // dialog opened, whose effect runs first.
  React.useLayoutEffect(() => {
    content.current
      ?.querySelector<HTMLElement>('button:not(:disabled):not([aria-disabled="true"])')
      ?.focus({ preventScroll: true });
  }, []);

  React.useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);

  const original = (row: SessionAddonRow) =>
    addOns.live ? (row.addon.pendingQuantity ?? row.quantity) : row.quantity;
  const quantityOf = (row: SessionAddonRow) => wanted.get(row.addon.slug) ?? original(row);
  // What the panel would change: the add-ons whose quantity is not the server's, in the list's order.
  const changes: Change[] = addOns.rows
    .filter((row) => quantityOf(row) !== original(row))
    .map((row) => ({ row, to: quantityOf(row) }));

  const stage = (row: SessionAddonRow, to: number) => {
    setRefused(null);
    setWanted((previous) => new Map(previous).set(row.addon.slug, to));
  };

  const close = (done: boolean) => {
    closed.current = true;
    onClose(done);
  };

  const confirm = async () => {
    if (inFlight.current || changes.length === 0) return;
    inFlight.current = true;
    setRefused(null);
    setSending(true);
    try {
      for (const { row, to } of changes) {
        try {
          await change.mutateAsync({ addonSlug: row.addon.slug, quantity: to });
        } catch {
          // Refused: the hook's `problem` says with what, and the panel says it of this add-on.
          if (closed.current) return;
          setRefused(row.addon.name);
          setSending(false);
          return;
        }
        if (closed.current) return;
      }
      close(true);
    } finally {
      inFlight.current = false;
    }
  };

  const failure =
    refused !== null && change.problem
      ? words.addonRefusedFor(refused, refusalText(change.problem, words))
      : null;
  // The fee a change is billed at from the renewal: a plan change scheduled for it bills the
  // add-ons at the fees of its own billing period.
  const billedAt = renewalSale(addOns.live) ?? addOns.sale;

  return (
    <Dialog
      onDismiss={() => close(false)}
      showCloseButton={false}
      unstyled={unstyled}
      className={unstyled ? undefined : "max-w-lg"}
    >
      <div className={unstyled ? undefined : "ktn-own flex flex-col gap-1.5 pr-2"}>
        {/* A heading in both renderings, as the summary under it is one. */}
        <h2 className={unstyled ? undefined : "ktn-own text-lg leading-none font-semibold"}>
          <DialogTitle unstyled>{words.addonsManage}</DialogTitle>
        </h2>
        <DialogDescription unstyled={unstyled}>{words.addonsManageNote}</DialogDescription>
      </div>

      <div
        ref={content}
        className={
          unstyled
            ? undefined
            : "ktn-own -mx-1 flex max-h-[calc(100vh-16rem)] flex-col gap-4 overflow-y-auto px-1 py-1"
        }
      >
        <ul className={unstyled ? undefined : "ktn-own flex flex-col gap-3"}>
          {addOns.rows.map((row) => {
            const quantity = quantityOf(row);
            const price = unitPriceText(row.addon, addOns.subscription, localization);
            const atMost = row.max !== null && quantity >= row.max;
            return (
              <li
                key={row.addon.slug}
                data-slot="addon-option"
                className={
                  unstyled
                    ? undefined
                    : "ktn-own flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-ktn-lg border border-ktn-border p-3"
                }
              >
                <div className={unstyled ? undefined : "ktn-own flex min-w-0 flex-col gap-1"}>
                  <span className={unstyled ? undefined : "ktn-own font-medium break-words"}>
                    {row.addon.name}
                  </span>{" "}
                  {price || row.max !== null ? (
                    <span
                      className={unstyled ? undefined : "ktn-own text-xs text-ktn-muted-foreground"}
                    >
                      {[price, row.max !== null ? words.addonUpTo(row.max.toLocaleString()) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  ) : null}
                  {pendingAddonText(row.addon, addOns.subscription, words) ? (
                    <p
                      data-slot="addon-pending-quantity"
                      className={cn("ktn-own", !unstyled && "text-sm break-words")}
                    >
                      {pendingAddonText(row.addon, addOns.subscription, words)}
                    </p>
                  ) : null}
                  {(row.version.entitlements ?? []).map((grant) => {
                    const operation =
                      grant.overrideBehavior === "OVERRIDE" ? "SET" : grant.overrideBehavior;
                    const effect = operation
                      ? grantDescription(operation, grant.value?.value, words, localization)
                      : null;
                    const allowance =
                      typeof grant.limitCapExceededOveragePercent === "number" &&
                      grant.limitCapExceededOveragePercent >= 0
                        ? words.addonOverage?.(String(grant.limitCapExceededOveragePercent))
                        : null;
                    return effect || allowance ? (
                      <p
                        key={grant.slug}
                        data-slot="addon-grant"
                        className={cn(
                          "ktn-own",
                          !unstyled && "text-xs break-words text-ktn-muted-foreground",
                        )}
                      >
                        {grant.name}: {[effect, allowance].filter(Boolean).join(" · ")}
                      </p>
                    ) : null;
                  })}
                </div>{" "}
                <div className={unstyled ? undefined : "ktn-own flex items-center gap-2"}>
                  <Action
                    unstyled={unstyled}
                    variant="outline"
                    size="sm"
                    label={words.addonLess(row.addon.name)}
                    busy={sending || quantity <= 0}
                    onClick={() => stage(row, quantity - 1)}
                  >
                    −
                  </Action>
                  <output
                    aria-label={words.addonQuantity(row.addon.name)}
                    className={
                      unstyled ? undefined : "ktn-own min-w-6 text-center font-mono text-sm"
                    }
                  >
                    {quantity}
                  </output>
                  <Action
                    unstyled={unstyled}
                    variant="outline"
                    size="sm"
                    label={words.addonMore(row.addon.name)}
                    busy={sending || atMost}
                    onClick={() => stage(row, quantity + 1)}
                  >
                    +
                  </Action>
                </div>
              </li>
            );
          })}
        </ul>

        <section
          data-slot="addon-changes"
          aria-labelledby={summaryId}
          className={
            unstyled
              ? undefined
              : "ktn-own flex flex-col gap-3 rounded-ktn-lg border border-ktn-border bg-ktn-secondary/40 p-3"
          }
        >
          <h3 id={summaryId} className={unstyled ? undefined : "ktn-own text-sm font-medium"}>
            {words.addonsSummary}
          </h3>
          {changes.length === 0 ? (
            <p className={unstyled ? undefined : "ktn-own text-sm text-ktn-muted-foreground"}>
              {words.addonsNoChange}
            </p>
          ) : (
            <ul className={unstyled ? undefined : "ktn-own flex flex-col gap-3"}>
              {changes.map(({ row, to }) => {
                const from = row.quantity;
                // The add-on's own fee for the subscription's period, never a total of fees: a
                // renewal's amount is the server's.
                const fee = billedAt ? addonFeeFor(row.version, billedAt) : null;
                const feeText = fee ? formatKaitenPrice(fee, localization) : null;
                const units = `${to > from ? "+" : "−"}${Math.abs(to - from)}`;
                return (
                  <li
                    key={row.addon.slug}
                    data-slot="addon-change"
                    className={unstyled ? undefined : "ktn-own flex flex-col gap-1 text-sm"}
                  >
                    <div
                      className={
                        unstyled
                          ? undefined
                          : "ktn-own flex flex-wrap items-baseline justify-between gap-x-3"
                      }
                    >
                      <span className={unstyled ? undefined : "ktn-own font-medium"}>
                        {row.addon.name}{" "}
                        <span
                          className={
                            unstyled ? undefined : "ktn-own font-normal text-ktn-muted-foreground"
                          }
                        >
                          {from} → {to}
                        </span>
                      </span>{" "}
                      <span
                        data-slot="addon-change-fee"
                        className={unstyled ? undefined : "ktn-own font-medium tabular-nums"}
                      >
                        {to === from ? null : feeText ? `${units} × ${feeText}` : units}
                      </span>
                    </div>
                    <p
                      className={unstyled ? undefined : "ktn-own text-xs text-ktn-muted-foreground"}
                    >
                      {whenText(row, to, addOns.live, words)}
                    </p>
                    {billingTimingText(fee, words) ? (
                      <p
                        data-slot="addon-change-billing-timing"
                        className={cn("ktn-own", !unstyled && "text-xs text-ktn-muted-foreground")}
                      >
                        {billingTimingText(fee, words)}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {change.retryAt !== null || failure ? (
        <div
          data-slot="addons-feedback"
          className={unstyled ? undefined : "ktn-own flex flex-col gap-2"}
        >
          {change.retryAt !== null ? (
            <Message unstyled={unstyled} tone="info" text={words.closingPeriod} busy />
          ) : null}
          {failure ? <Message unstyled={unstyled} tone="error" text={failure} /> : null}
        </div>
      ) : null}

      <div className={unstyled ? undefined : "ktn-own flex flex-wrap justify-end gap-2"}>
        <Action unstyled={unstyled} variant="outline" onClick={() => close(false)}>
          {words.addonsCancel}
        </Action>
        <Action
          unstyled={unstyled}
          variant="default"
          busy={sending || changes.length === 0}
          onClick={() => void confirm()}
        >
          {words.addonsConfirm}
        </Action>
      </div>
    </Dialog>
  );
}
