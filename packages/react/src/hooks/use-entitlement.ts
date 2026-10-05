import * as React from "react";

import type { LicenseEntitlement } from "../types.ts";
import { warnUnknownEntitlement } from "../lib/unknown-entitlement.ts";
import { useLicenseEntitlementsList } from "./use-entitlements.ts";
import type { UseKaitenQueryResult } from "./use-kaiten-query.ts";

export function useEntitlement(entitlementSlug: string): UseKaitenQueryResult<LicenseEntitlement> {
  const entitlements = useLicenseEntitlementsList();
  const matched = entitlements.data?.find(
    (entitlement) => entitlement.entitlementSlug === entitlementSlug,
  );

  // `data: undefined` for an unknown slug is indistinguishable from "still
  // loading" at the call site, so a typo here is as quiet as it is in
  // `useEntitlementCheck`.
  React.useEffect(() => {
    warnUnknownEntitlement({
      hook: "useEntitlement",
      slug: entitlementSlug,
      // `entitlementSlug` is optional on the API type even though every row the
      // snapshot mapper builds carries one; drop the theoretical blanks rather
      // than listing "undefined" among the available slugs.
      known: entitlements.data
        ?.map((entitlement) => entitlement.entitlementSlug)
        .filter((slug): slug is string => Boolean(slug)),
      isLoading: entitlements.isLoading,
      error: entitlements.error,
    });
  }, [entitlementSlug, entitlements.data, entitlements.error, entitlements.isLoading]);

  return {
    data: matched,
    isLoading: entitlements.isLoading,
    error: entitlements.error,
    refetch: entitlements.refetch,
  };
}
