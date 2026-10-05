// The provider a test of a styled component mounts.
//
// A host that draws mounts `KaitenProvider` for the data and, under it, one
// `KaitenStyleRoot` for the element every SDK style is scoped to. These wrap the
// two so a test reads like the component's own docs — `<KaitenProvider …>` — and
// so `appearance`, which is the style root's, can be given where the provider is.
// Without the root every styled component would warn (once, per component) that
// it renders unstyled, which is right for a host and noise for a test.

import type { ReactNode } from "react";
import {
  KaitenProvider as CoreProvider,
  KaitenSessionProvider as CoreSessionProvider,
  type KaitenProviderProps,
  type KaitenSessionProviderProps,
} from "@kaitencloud/react";

import type { KaitenAppearance } from "../../src/appearance/types.ts";
import { KaitenStyleRoot } from "../../src/style-root/kaiten-style-root.tsx";

interface StyledProps {
  appearance?: KaitenAppearance;
  children: ReactNode;
}

export function KaitenProvider({ appearance, ...props }: KaitenProviderProps & StyledProps) {
  return (
    <CoreProvider {...props}>
      <KaitenStyleRoot appearance={appearance}>{props.children}</KaitenStyleRoot>
    </CoreProvider>
  );
}

export function KaitenSessionProvider({
  appearance,
  children,
  ...props
}: KaitenSessionProviderProps & StyledProps) {
  return (
    <CoreSessionProvider {...props}>
      <KaitenStyleRoot appearance={appearance}>{children}</KaitenStyleRoot>
    </CoreSessionProvider>
  );
}
