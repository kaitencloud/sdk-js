// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { memo } from "react";

import {
  emitKaitenEvent,
  useAddOns,
  useCredits,
  useKaitenSessionClient,
  useLocalization,
  type Addon,
} from "@kaitencloud/react";
import { useMergedAppearance } from "../../../appearance/context.tsx";
import { cn } from "../../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../../style-root/kaiten-style-root.tsx";
import { useTrackComponent } from "@kaitencloud/react/internal";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card.tsx";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { KaitenBranding } from "../../shared/kaiten-branding.tsx";
import { SectionError } from "../../shared/section-error.tsx";
import type { KaitenAppearance } from "../../../appearance/types.ts";
import { getAddonDisplayPrice } from "./addon-price.ts";
import { SessionAddOns } from "./session-addons.tsx";

export interface AddOnsProps {
  appearance?: KaitenAppearance;
  unstyled?: boolean;
  onManageAddon?: (addon: Addon) => void | Promise<void>;
}

async function handleAddonAction(
  addon: Addon,
  onManageAddon?: (addon: Addon) => void | Promise<void>,
): Promise<void> {
  await onManageAddon?.(addon);
  emitKaitenEvent("kaiten:addon-added", {
    addonId: addon.id,
    addonSlug: addon.slug,
  });
}

// Memoized: guards against host-driven re-renders with unchanged props.
// Pass a stable `onManageAddon` (e.g. useCallback) to get the full benefit.
export const AddOns = /* @__PURE__ */ memo(AddOnsImpl);

function AddOnsImpl(props: AddOnsProps) {
  useAssertWrappedByKaitenProvider("AddOns");
  useTrackComponent("AddOns");

  // A customer session changes the quantity of an add-on itself, with the controls of its own;
  // under any other mode the host owns the change, and `onManageAddon` is how it hears of it.
  return useKaitenSessionClient() ? <SessionAddOns {...props} /> : <SnapshotAddOns {...props} />;
}

function SnapshotAddOns({ appearance, unstyled = false, onManageAddon }: AddOnsProps) {
  const merged = useMergedAppearance(appearance);
  const addOns = useAddOns();
  const credits = useCredits();
  const localization = useLocalization();

  if (addOns.isLoading || credits.isLoading) {
    return (
      <Card className={cn(merged.elements?.card)}>
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

  const items = addOns.data ?? [];
  const balances = credits.data ?? [];
  if ((addOns.error || credits.error) && !items.length && !balances.length) {
    return <SectionError onRetry={addOns.refetch} appearance={merged} unstyled={unstyled} />;
  }
  if (!items.length && !balances.length) return null;

  if (unstyled) {
    return (
      <section data-slot="addons" className="ktn-own">
        <h3>{localization.addOns.title}</h3>
        <ul>
          {items.map((addon) => (
            <li key={addon.slug}>
              {addon.name} -{" "}
              {addon.active ? localization.addOns.active : localization.addOns.available}
            </li>
          ))}
        </ul>
        <ul>
          {balances.map((credit) => (
            <li key={credit.slug}>
              {credit.name}: {credit.available} {credit.unit}
            </li>
          ))}
        </ul>
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
        {items.map((addon) => (
          <div
            key={addon.slug}
            /*
             * A wrapping row, not a stack that becomes a row at a window breakpoint.
             * Keyed to the window, `md:flex-row` turned this into a side-by-side row
             * inside a 320px slot on any desktop browser and pushed the action button
             * out of the card — part of CustomerPortal's 125px overflow.
             *
             * Wrapping needs no query at all: name and action sit side by side while
             * they fit and the action drops to its own line when they do not, at every
             * width, in any slot. `min-w-0` on the text block below is what lets it
             * give ground first instead of holding the row open.
             */
            className="flex flex-wrap items-center justify-between gap-3 rounded-ktn-lg border border-ktn-border p-4"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{addon.name}</span>
                <Badge variant={addon.active ? "success" : "outline"}>
                  {addon.active ? localization.addOns.active : localization.addOns.available}
                </Badge>
              </div>
              {addon.description ? (
                <p className="text-sm text-ktn-muted-foreground">{addon.description}</p>
              ) : null}
              {(() => {
                const price = getAddonDisplayPrice(addon);
                if (!price) return null;
                return (
                  <p className="text-sm text-ktn-muted-foreground">
                    {localization.formatMoney(price.amount, price.currencyCode)}/{price.interval}
                  </p>
                );
              })()}
            </div>
            <Button
              size="sm"
              variant={addon.active ? "outline" : "default"}
              onClick={() => void handleAddonAction(addon, onManageAddon)}
            >
              {addon.active ? localization.addOns.remove : localization.addOns.add}
            </Button>
          </div>
        ))}

        {balances.length ? (
          <div className="rounded-ktn-lg border border-ktn-border bg-ktn-secondary/40 p-4">
            <p className="mb-3 text-sm font-medium">{localization.addOns.quotaAndCredits}</p>
            <div className="grid gap-2">
              {balances.map((credit) => (
                <div key={credit.slug} className="flex items-center justify-between gap-2 text-sm">
                  <span>{credit.name}</span>
                  <span className="font-mono text-ktn-muted-foreground">
                    {credit.available.toLocaleString()} {credit.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
      <KaitenBranding className="-mb-6" />
    </Card>
  );
}
