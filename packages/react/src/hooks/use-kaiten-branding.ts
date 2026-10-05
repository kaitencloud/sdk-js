import * as React from "react";

import { useKaitenContext, useKaitenDataContext } from "../providers/kaiten-provider.tsx";
import { useTelemetry, useTrackHook } from "../telemetry/context.tsx";

export interface KaitenBrandingState {
  /** Whether the active Kaiten license allows the "Powered by Kaiten" mark to be removed. */
  removable: boolean;
  /**
   * Whether to render the mark at all: the provider's `hideBranding`, granted
   * only when the license makes it `removable`. This is the one value a host
   * rendering its own footer needs.
   */
  hidden: boolean;
}

function isProduction(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV === "production";
}

/**
 * The branding rule, for a host that renders the "Powered by Kaiten" mark in its
 * own markup (`@kaitencloud/react-ui`'s `KaitenBranding` is this hook plus a
 * default rendering).
 *
 * Server-enforced: the server's answer wins over the safe default, and any value
 * other than a strict `true` reads as "not removable" so a malformed response
 * cannot hide the mark. Asking to hide it without a license that allows it
 * keeps it visible, emits a one-shot `branding.bypass_attempted` telemetry
 * event so Kaiten can see the attempt, and says why in development.
 */
export function useKaitenBranding(): KaitenBrandingState {
  useTrackHook("useKaitenBranding");

  const { hideBranding } = useKaitenContext();
  const { branding, catalog, snapshot } = useKaitenDataContext();
  const telemetry = useTelemetry();

  const resolvedBranding = snapshot.data?.branding ?? catalog.data?.branding ?? branding;
  const removable = resolvedBranding.removable === true;
  const bypassAttempted = hideBranding && !removable;

  React.useEffect(() => {
    if (!bypassAttempted) return;
    telemetry.track(
      {
        type: "action",
        name: "branding.bypass_attempted",
        metadata: { removable: resolvedBranding.removable },
      },
      "branding:bypass_attempted",
    );
    if (!isProduction()) {
      console.warn(
        "[@kaitencloud/react] `hideBranding` was set but the current Kaiten license does not allow removal. The Kaiten branding will remain visible. Upgrade the license to enable removal.",
      );
    }
  }, [bypassAttempted, resolvedBranding.removable, telemetry]);

  return React.useMemo(
    () => ({ removable, hidden: hideBranding && removable }),
    [hideBranding, removable],
  );
}
