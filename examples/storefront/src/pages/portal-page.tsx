// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";

import { CustomerPortal, usePlans, usePortal } from "@kaitencloud/react-ui";

import { useAccount, useTitleFocusAfterSignUp } from "../account.tsx";
import { changePlanTarget } from "../change-plan.ts";
import { navigate } from "../router.tsx";
import { useDocumentTitle } from "../title.ts";
import { SignUpStep } from "./sign-up-step.tsx";

export function PortalPage() {
  const { data: plans } = usePlans();
  const { data: portal } = usePortal();
  const account = useAccount();
  const [leaving, setLeaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useTitleFocusAfterSignUp(true);
  useDocumentTitle("Your account");

  // The account is a customer's: a visitor makes one first.
  if (!account.signedIn) return <SignUpStep />;

  return (
    <section aria-labelledby="portal-title">
      <div className="portal-heading">
        <h1 id="portal-title" className="page-heading">
          Your account
        </h1>
        {account.accounts === "sign-up" ? (
          <div className="portal-identity">
            {portal?.customer ? (
              <p className="muted" data-testid="signed-in-as">
                Signed in as {portal.customer.name}
              </p>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={leaving}
              onClick={() => {
                setLeaving(true);
                setFailure(null);
                account.signOut().catch((error: unknown) => {
                  setLeaving(false);
                  setFailure(error instanceof Error ? error.message : String(error));
                });
              }}
            >
              Sign out
            </button>
          </div>
        ) : null}
      </div>
      {failure ? (
        <p className="notice error" role="alert">
          {failure}
        </p>
      ) : null}
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
