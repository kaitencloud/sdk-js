// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { DEFAULT_CURRENCY_CODE, type Addon, type CurrencyCode } from "@kaitencloud/react";

export interface AddonDisplayPrice {
  /** Minor units (integer). */
  amount: number;
  currencyCode: CurrencyCode;
  interval: string;
}

export function getAddonDisplayPrice(addon: Addon): AddonDisplayPrice | null {
  if (typeof addon.price === "number") {
    return {
      amount: addon.price,
      currencyCode: addon.currencyCode ?? DEFAULT_CURRENCY_CODE,
      interval: addon.interval ?? "month",
    };
  }
  const firstPrice = addon.prices?.[0];
  if (firstPrice && typeof firstPrice.amount === "number") {
    return {
      amount: firstPrice.amount,
      currencyCode: firstPrice.currencyCode ?? addon.currencyCode ?? DEFAULT_CURRENCY_CODE,
      interval: firstPrice.interval ?? addon.interval ?? "month",
    };
  }
  return null;
}
