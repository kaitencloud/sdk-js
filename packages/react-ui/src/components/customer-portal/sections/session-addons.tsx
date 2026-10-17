// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { useLocalization } from "@kaitencloud/react";

import { useMergedAppearance } from "../../../appearance/context.tsx";
import type { KaitenAppearance } from "../../../appearance/types.ts";
import { cn } from "../../../lib/utils.ts";
import { usePortalBillingWords } from "../../shared/billing-words.ts";
import { KaitenBranding } from "../../shared/kaiten-branding.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { useAddOnsPanel } from "./addons-panel-state.ts";
import { ManageAddOns } from "./manage-addons.tsx";
import { unitPriceText, useSessionAddOns } from "./session-addon-rows.ts";

/**
 * The add-ons of a customer session: what the instance holds, each with its quantity and the price
 * of one unit, and the way into the panel where they are changed (see `ManageAddOns`), which also
 * offers the public add-ons of the catalogue that fit the plan and that Kaiten attaches to its
 * subscription. Nothing here changes a quantity: a change is made in the panel, where the customer
 * sees what it does to the subscription before it is sent.
 *
 * The section is there when the instance holds an add-on or is offered one, and says so when it
 * holds none. An unbound session has no instance to attach anything to, and no section.
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
  const addOns = useSessionAddOns();
  const panel = useAddOnsPanel();

  if (addOns.isLoading) {
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
  // Nothing held and nothing offered is no section, unless its panel or what it said is on screen:
  // the last add-on just went.
  if (addOns.rows.length === 0 && !panel.active) return null;

  const priceOf = (row: (typeof addOns.held)[number]) =>
    unitPriceText(row.addon, addOns.subscription, localization);

  if (unstyled) {
    return (
      <section data-slot="addons" className="ktn-own">
        <h3>{localization.addOns.title}</h3>
        {addOns.held.length ? (
          <ul>
            {addOns.held.map((row) => {
              const price = priceOf(row);
              return (
                <li key={row.addon.slug} data-slot="addon" className="ktn-own">
                  <span>{row.addon.name}</span>{" "}
                  <span data-slot="addon-quantity" className="ktn-own">
                    × {row.quantity}
                  </span>
                  {price ? <> {price}</> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>{words.addonsNone}</p>
        )}
        <ManageAddOns addOns={addOns} panel={panel} unstyled />
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
        {addOns.held.length ? (
          <ul className="ktn-own grid gap-3">
            {addOns.held.map((row) => {
              const price = priceOf(row);
              return (
                <li
                  key={row.addon.slug}
                  data-slot="addon"
                  className="ktn-own flex items-center justify-between gap-4 rounded-ktn-lg border border-ktn-border p-4"
                >
                  <div className="ktn-own flex min-w-0 flex-col gap-1">
                    <span className="ktn-own font-medium break-words">{row.addon.name}</span>
                    {row.addon.description ? (
                      <span className="ktn-own text-sm text-ktn-muted-foreground">
                        {row.addon.description}
                      </span>
                    ) : null}
                    {price ? (
                      <span className="ktn-own text-xs text-ktn-muted-foreground">{price}</span>
                    ) : null}
                  </div>
                  <span
                    data-slot="addon-quantity"
                    className="ktn-own shrink-0 font-mono text-sm font-medium"
                  >
                    <span className="sr-only">{words.addonQuantity(row.addon.name)}: </span>
                    <span aria-hidden="true">× </span>
                    {row.quantity}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="ktn-own text-sm text-ktn-muted-foreground">{words.addonsNone}</p>
        )}
        <ManageAddOns addOns={addOns} panel={panel} unstyled={false} />
      </CardContent>
      <KaitenBranding className="-mb-6" />
    </Card>
  );
}
