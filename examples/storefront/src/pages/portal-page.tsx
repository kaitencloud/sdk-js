// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { CustomerPortal, usePlans, usePortal } from "@kaitencloud/react-ui";

import { changePlanTarget } from "../change-plan.ts";
import { navigate } from "../router.tsx";

export function PortalPage() {
  const { data: plans } = usePlans();
  const { data: portal } = usePortal();

  return (
    <section aria-labelledby="portal-title">
      <h1 id="portal-title" className="page-heading">
        Your account
      </h1>
      <CustomerPortal
        // "Change plan" is a commercial request in V1: it goes where the plan's vendor sends it
        // (see change-plan.ts). The component shows the button because a handler is given.
        onUpgradeVersion={() => {
          const target = changePlanTarget(
            plans,
            portal?.instance?.licenseSlug,
            window.location.origin,
          );
          if (target.kind === "page") navigate(target.to);
          else window.open(target.href, "_blank", "noopener,noreferrer");
        }}
      />
    </section>
  );
}
