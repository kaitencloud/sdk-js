// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What a visitor who has no account does at a plan's checkout. When the publishable key opens the anonymous
// checkout, they buy the plan right there: an email, a security check, and, for a paid plan, a card on the
// provider's page. Kaiten makes the customer, its instance and the subscription when it completes, and the
// storefront's backend is not asked for anything. When the key does not open it, the visitor first makes an
// account (`SignUpStep`), and the checkout of a customer follows.

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { KaitenClient, readCheckoutReturn } from "@kaitencloud/client";
import type { AnonymousCheckoutOutcome } from "@kaitencloud/react/billing";
import { AnonymousCheckoutFlow, type Plan } from "@kaitencloud/react-ui";

import type { StorefrontConfig } from "./config.ts";
import { Link, navigate } from "./router.tsx";
import { SignUpStep } from "./pages/sign-up-step.tsx";

/** The address of Kaiten and the publishable key, for the parts of the page that read the catalogue themselves. */
export const StorefrontConfigContext = createContext<StorefrontConfig | null>(null);

/**
 * Whether the catalogue says that this publishable key starts an anonymous checkout: `null` while it is
 * read, and `false` when it cannot be (the visitor then signs up, which needs no more than the plans did).
 *
 * This is a workaround for a gap in the SDK, which has no way to read the key's capability: the provider
 * reads the catalogue for the plans already, but does not hand `capabilities` out, and
 * `AnonymousCheckoutFlow` draws nothing when the answer is no. A page that chooses between the flow and
 * the sign-up step needs the answer itself, so it reads the catalogue once more, with a client of its own
 * (no plans, and no cache shared with the provider's read). A catalogue that cannot be read is taken as
 * "not offered", and so is a page that has no configuration to read it with.
 */
export function useAnonymousCheckoutOffered(): boolean | null {
  const config = useContext(StorefrontConfigContext);
  const [offered, setOffered] = useState<boolean | null>(null);
  useEffect(() => {
    if (!config) {
      setOffered(false);
      return;
    }
    let cancelled = false;
    const client = new KaitenClient({
      apiUrl: config.apiUrl,
      authScheme: "publishable",
      tokenProvider: () => config.publishableKey,
    });
    client.getCatalog({ include: "none" }).then(
      (catalog) => {
        if (!cancelled) setOffered(catalog.capabilities?.anonymousCheckout === true);
      },
      () => {
        if (!cancelled) setOffered(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [config]);
  return offered;
}

/** A reference of the visitor's own that Kaiten echoes on the events of their checkout, here a made-up order number. */
function newOrderReference(): string {
  const random = crypto.getRandomValues(new Uint8Array(4));
  return `order-${Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function VisitorCheckout({ plan, priceId }: { plan: Plan; priceId: string | undefined }) {
  const offered = useAnonymousCheckoutOffered();
  // Back from the provider's page, the checkout goes on whatever the catalogue says now.
  const [returning] = useState(() => readCheckoutReturn() !== null);
  // The reference this page gives the start. A page that is loaded again after the provider's (when the
  // browser blocked the popup) makes another, so it is never the one to print: the outcome has the
  // session's own, which Kaiten echoes on its events.
  const [reference] = useState(newOrderReference);
  const [completed, setCompleted] = useState<AnonymousCheckoutOutcome | null>(null);
  const title = useMemo(() => `Subscribe to ${plan.name}`, [plan.name]);

  // The page is a new one to a keyboard or screen-reader user: they start at its title.
  const heading = useRef<HTMLHeadingElement>(null);
  const waiting = offered === null && !returning;
  const signUp = offered === false && !returning;
  useEffect(() => {
    if (!signUp) heading.current?.focus({ preventScroll: true });
  }, [signUp]);

  if (signUp) return <SignUpStep plan={{ slug: plan.slug, name: plan.name }} />;

  return (
    <section aria-labelledby="checkout-title" className="page-narrow">
      <h1 ref={heading} tabIndex={-1} id="checkout-title" className="page-heading">
        {title}
      </h1>
      {waiting ? (
        <p role="status">Loading the plan…</p>
      ) : (
        <>
          {/* Mounted on the page the visitor comes back to from the provider's: see the README. */}
          <AnonymousCheckoutFlow
            plan={plan}
            priceId={priceId}
            clientReferenceId={reference}
            onSubscribed={setCompleted}
            onCancel={() => navigate("/")}
          />
          {completed ? (
            <div className="visitor-done" data-testid="visitor-done">
              <p>
                Thank you for your order. <Link to="/">Back to the plans</Link>
              </p>
              {/* A note for the person who builds the shop, not for the person who just bought: folded away. */}
              <details className="visitor-dev-note small muted" data-testid="visitor-dev-note">
                <summary>For the vendor, not the buyer</summary>
                <p>
                  Kaiten has made the customer and its instance for this address. It sends no email
                  to your buyers: a shop&rsquo;s backend hears of the order from the{" "}
                  <code>checkout_session.v1.completed</code> event, which carries the reference{" "}
                  <code data-testid="visitor-reference">
                    {completed.clientReferenceId ?? "none"}
                  </code>
                  , and gives the buyer their account.
                </p>
              </details>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
