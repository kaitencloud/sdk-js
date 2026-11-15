// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import type { KaitenIconComponent, KaitenIcons } from "./types.ts";
import { useAppearance } from "./context.tsx";
import {
  CheckIcon as DefaultCheck,
  XIcon as DefaultX,
  AlertTriangleIcon as DefaultAlertTriangle,
  LockIcon as DefaultLock,
  ArrowUpRightIcon as DefaultArrowUpRight,
  ArrowRightIcon as DefaultArrowRight,
  CreditCardIcon as DefaultCreditCard,
  PlusIcon as DefaultPlus,
  ZapIcon as DefaultZap,
  ShieldIcon as DefaultShield,
  ChevronRightIcon as DefaultChevronRight,
  LoaderIcon as DefaultLoader,
  InfinityIcon as DefaultInfinity,
} from "../components/shared/icons.tsx";

const defaults: Required<KaitenIcons> = {
  check: DefaultCheck,
  x: DefaultX,
  alertTriangle: DefaultAlertTriangle,
  lock: DefaultLock,
  arrowUpRight: DefaultArrowUpRight,
  arrowRight: DefaultArrowRight,
  creditCard: DefaultCreditCard,
  plus: DefaultPlus,
  zap: DefaultZap,
  shield: DefaultShield,
  chevronRight: DefaultChevronRight,
  loader: DefaultLoader,
  infinity: DefaultInfinity,
};

export function useIcons(): Required<KaitenIcons> {
  const { icons } = useAppearance();
  return React.useMemo(() => ({ ...defaults, ...icons }), [icons]);
}

export function useIcon(name: keyof KaitenIcons): KaitenIconComponent {
  const icons = useIcons();
  return icons[name];
}
